import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import {
  DEFAULT_CATEGORY_BLUEPRINTS,
  getSupabaseAdminClient,
  getSupabasePublicClient,
  hasServiceRoleKey,
  isServerSupabaseConfigured,
} from './server/supabaseAdmin.ts';
import {
  type AuthenticatedRequest,
  createRateLimiter,
  getClientIp,
  parseDiscordSnowflakeAge,
  requireAdministrator,
  requireAuthenticatedUser,
  sha256Hex,
  writeAuditLog,
} from './server/security.ts';
import { calculateAwardsYearResults } from './server/scoringEngine.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json({ limit: '6mb' }));

const generalLimiter = createRateLimiter({ windowMs: 60_000, max: 180, prefix: 'api' });
const voteLimiter = createRateLimiter({ windowMs: 60_000, max: 25, prefix: 'vote' });
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 30, prefix: 'auth' });

app.use('/api', generalLimiter);

// ============================================================================
// IFRAME-SAFE OAUTH POPUP CALLBACK HANDLER
// ============================================================================
app.get(['/auth/callback', '/auth/callback/'], (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>MultiCraft Awards Authentication</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, sans-serif;
        background: #08080a;
        color: #f5f5f2;
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 24px;
      }
      .card {
        max-width: 380px;
        border: 1px solid rgba(229, 184, 66, 0.3);
        background: #111114;
        border-radius: 12px;
        padding: 24px;
      }
      h1 { font-size: 18px; margin: 0 0 8px; color: #e5b842; }
      p { font-size: 14px; margin: 0; color: #a6a6ae; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Completing Sign-In</h1>
      <p>Returning your verified session to MultiCraft Awards. This window will close automatically.</p>
    </div>
    <script>
      (function () {
        var payload = {
          type: 'MULTICRAFT_OAUTH_CALLBACK',
          hash: window.location.hash || '',
          search: window.location.search || '',
          ts: Date.now()
        };
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            var ch = new BroadcastChannel('multicraft_oauth_channel');
            ch.postMessage(payload);
            ch.close();
          }
        } catch (e) {}
        try {
          window.localStorage.setItem('mc_oauth_callback', JSON.stringify(payload));
        } catch (e) {}
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(payload, window.location.origin);
          } catch (e) {}
          setTimeout(function () { window.close(); }, 200);
        } else {
          window.location.href = '/' + (window.location.search || '') + (window.location.hash || '');
        }
      })();
    </script>
  </body>
</html>`);
});

// ============================================================================
// HEALTH & PUBLIC API
// ============================================================================
app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    supabaseConfigured: isServerSupabaseConfigured(),
    hasServiceRole: hasServiceRoleKey(),
  });
});

async function ensureCurrentCalendarYear() {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) return;
  const currentYear = new Date().getFullYear();

  const { data: existingCurrent } = await adminClient
    .from('awards_years')
    .select('id')
    .eq('year_label', currentYear)
    .maybeSingle();

  if (existingCurrent) return;

  // Automatically advance active year when a new calendar year begins
  const { data: prevYear } = await adminClient
    .from('awards_years')
    .select('*')
    .order('year_label', { ascending: false })
    .limit(1)
    .maybeSingle();

  await adminClient.from('awards_years').update({ is_active: false }).neq('year_label', currentYear);

  const { data: newYear } = await adminClient
    .from('awards_years')
    .insert({
      year_label: currentYear,
      title: `MultiCraft Awards ${currentYear}`,
      description:
        'Annual honors celebrating builders, creators, PvP competitors, bluestoners, and teams in the MultiCraft Build and Mine community.',
      status: 'voting_active',
      tie_policy: prevYear?.tie_policy || 'shared_rank',
      allow_vote_editing: prevYear?.allow_vote_editing ?? false,
      is_active: true,
    })
    .select('*')
    .single();

  if (!newYear) return;

  if (prevYear) {
    const { data: prevCats } = await adminClient
      .from('categories')
      .select('*, point_rules:category_point_rules(*)')
      .eq('awards_year_id', prevYear.id)
      .order('display_order', { ascending: true });

    if (prevCats && prevCats.length > 0) {
      for (const c of prevCats) {
        const { data: clonedCat } = await adminClient
          .from('categories')
          .insert({
            awards_year_id: newYear.id,
            slug: c.slug,
            name: c.name,
            description: c.description,
            icon_url: c.icon_url,
            icon_name: c.icon_name,
            display_order: c.display_order,
            winning_positions_count: c.winning_positions_count,
            is_enabled: c.is_enabled,
            is_team_category: c.is_team_category,
          })
          .select('*')
          .single();

        if (clonedCat && Array.isArray(c.point_rules) && c.point_rules.length > 0) {
          await adminClient.from('category_point_rules').insert(
            c.point_rules.map((r: { position: number; points: number }) => ({
              category_id: clonedCat.id,
              position: r.position,
              points: r.points,
            }))
          );
        }
      }
      return;
    }
  }

  for (const bp of DEFAULT_CATEGORY_BLUEPRINTS) {
    const { data: cat } = await adminClient
      .from('categories')
      .insert({
        awards_year_id: newYear.id,
        slug: bp.slug,
        name: bp.name,
        description: bp.description,
        icon_name: bp.icon_name,
        display_order: bp.display_order,
        winning_positions_count: bp.winning_positions_count,
        is_enabled: true,
        is_team_category: bp.is_team_category,
      })
      .select('*')
      .single();

    if (cat) {
      await adminClient.from('category_point_rules').insert(
        bp.point_rules.map((r) => ({
          category_id: cat.id,
          position: r.position,
          points: r.points,
        }))
      );
    }
  }
}

app.get('/api/public/bootstrap', async (req: Request, res: Response) => {
  const supabaseConfigured = isServerSupabaseConfigured();
  const db = getSupabaseAdminClient() || getSupabasePublicClient();
  const currentYear = new Date().getFullYear();

  if (!supabaseConfigured || !db) {
    // Provide clean empty state with default category blueprints metadata only (no fake users/nominees/votes/results)
    const fallbackYearObj = {
      id: `blueprint-${currentYear}`,
      year_label: currentYear,
      title: `MultiCraft Awards ${currentYear}`,
      description:
        'Annual honors celebrating builders, creators, PvP competitors, bluestoners, and teams in the MultiCraft Build and Mine community.',
      voting_starts_at: null,
      voting_ends_at: null,
      status: 'voting_active',
      tie_policy: 'shared_rank',
      allow_vote_editing: false,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fallbackCategories = DEFAULT_CATEGORY_BLUEPRINTS.map((c, idx) => ({
      id: `blueprint-${idx + 1}`,
      awards_year_id: fallbackYearObj.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      icon_url: null,
      icon_name: c.icon_name,
      display_order: c.display_order,
      winning_positions_count: c.winning_positions_count,
      is_enabled: true,
      is_team_category: c.is_team_category,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      point_rules: c.point_rules.map((r, rIdx) => ({
        id: `blueprint-rule-${idx + 1}-${rIdx + 1}`,
        category_id: `blueprint-cat-${idx + 1}`,
        position: r.position,
        points: r.points,
      })),
    }));

    res.json({
      supabaseConfigured: false,
      years: [fallbackYearObj],
      selectedYear: fallbackYearObj,
      categories: fallbackCategories,
      nominees: [],
      resultsPublished: false,
      categoryResults: null,
      overallRankings: null,
    });
    return;
  }

  await ensureCurrentCalendarYear();

  try {
    const requestedYearId = typeof req.query.yearId === 'string' ? req.query.yearId : null;
    const { data: years, error: yearsErr } = await db
      .from('awards_years')
      .select('*')
      .order('year_label', { ascending: false });

    if (yearsErr) throw yearsErr;

    const yearsList = years || [];
    const selectedYear =
      (requestedYearId ? yearsList.find((y) => y.id === requestedYearId) : null) ||
      yearsList.find((y) => y.is_active) ||
      yearsList[0] ||
      null;

    if (!selectedYear) {
      res.json({
        supabaseConfigured: true,
        years: [],
        selectedYear: null,
        categories: [],
        nominees: [],
        resultsPublished: false,
        categoryResults: null,
        overallRankings: null,
      });
      return;
    }

    const [{ data: categories }, { data: nominees }] = await Promise.all([
      db
        .from('categories')
        .select('*, point_rules:category_point_rules(*)')
        .eq('awards_year_id', selectedYear.id)
        .eq('is_enabled', true)
        .order('display_order', { ascending: true }),
      db
        .from('nominees')
        .select(
          '*, player:players(*), team:teams(*, members:team_members(*, player:players(*)))'
        )
        .eq('awards_year_id', selectedYear.id)
        .eq('is_active', true)
        .order('display_name', { ascending: true }),
    ]);

    const resultsPublished = selectedYear.status === 'results_published';
    let categoryResults = null;
    let overallRankings = null;

    // Strictly hide all counts, percentages, rankings, and points until results are officially published
    if (resultsPublished) {
      const [{ data: catRes }, { data: rankings }, { data: playerAwards }] = await Promise.all([
        db
          .from('category_results')
          .select('*, nominee:nominees(*, player:players(*), team:teams(*))')
          .eq('awards_year_id', selectedYear.id)
          .order('position', { ascending: true }),
        db
          .from('overall_rankings')
          .select('*, player:players(*)')
          .eq('awards_year_id', selectedYear.id)
          .order('rank_position', { ascending: true }),
        db
          .from('player_awards')
          .select('*, category:categories(id, name, slug), nominee:nominees(id, display_name, nominee_type)')
          .eq('awards_year_id', selectedYear.id)
          .order('position', { ascending: true }),
      ]);

      categoryResults = catRes || [];
      const awardsByPlayer = new Map<string, typeof playerAwards>();
      for (const award of playerAwards || []) {
        const list = awardsByPlayer.get(award.player_id) || [];
        list.push(award);
        awardsByPlayer.set(award.player_id, list);
      }

      overallRankings = (rankings || []).map((row) => ({
        ...row,
        awards: awardsByPlayer.get(row.player_id) || [],
      }));
    }

    res.json({
      supabaseConfigured: true,
      years: yearsList,
      selectedYear,
      categories: (categories || []).map((c) => ({
        ...c,
        point_rules: (c.point_rules || []).sort(
          (a: { position: number }, b: { position: number }) => a.position - b.position
        ),
      })),
      nominees: nominees || [],
      resultsPublished,
      categoryResults,
      overallRankings,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load awards data.',
    });
  }
});

// ============================================================================
// AUTHENTICATION & EMAIL VERIFICATION
// ============================================================================
async function buildVoterSessionState(authUser: NonNullable<AuthenticatedRequest['authUser']>, yearId?: string | null) {
  const adminClient = getSupabaseAdminClient();
  const normalizedEmail = (authUser.email || '').trim().toLowerCase();

  if (!adminClient) {
    return {
      voter: null,
      eligibilities: [],
      emailVerified: Boolean(authUser.email_confirmed_at),
      overallEligible: Boolean(authUser.email_confirmed_at),
      eligibilitySummary: 'Supabase service role key required to evaluate voter session.',
      votes: [],
      isAdmin: false,
      adminRole: null,
    };
  }

  const [{ data: voter }, { data: adminRow }] = await Promise.all([
    adminClient.from('voter_identities').select('*').eq('auth_user_id', authUser.id).maybeSingle(),
    adminClient
      .from('administrator_roles')
      .select('id, role, is_active, auth_user_id')
      .or(normalizedEmail ? `auth_user_id.eq.${authUser.id},email.eq.${normalizedEmail}` : `auth_user_id.eq.${authUser.id}`)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  if (adminRow && !adminRow.auth_user_id) {
    await adminClient
      .from('administrator_roles')
      .update({ auth_user_id: authUser.id })
      .eq('id', adminRow.id);
  }

  const emailVerified = Boolean(authUser.email_confirmed_at || voter?.google_email_verified);

  if (!voter) {
    return {
      voter: null,
      eligibilities: [],
      emailVerified,
      overallEligible: emailVerified,
      eligibilitySummary: emailVerified
        ? 'Email verified and ready to vote.'
        : 'Confirm your email verification link before voting.',
      votes: [],
      isAdmin: Boolean(adminRow),
      adminRole: adminRow?.role || null,
    };
  }

  const { data: eligibilities } = await adminClient
    .from('eligibility_records')
    .select('*')
    .eq('voter_identity_id', voter.id);

  let votesList: Array<Record<string, unknown>> = [];
  if (yearId) {
    const { data: votes } = await adminClient
      .from('votes')
      .select('id, awards_year_id, category_id, nominee_id, voter_id, created_at, updated_at')
      .eq('voter_id', voter.id)
      .eq('awards_year_id', yearId);
    votesList = votes || [];
  }

  return {
    voter,
    eligibilities: eligibilities || [],
    emailVerified,
    overallEligible: emailVerified,
    eligibilitySummary: emailVerified
      ? 'Email verified and eligible to vote.'
      : 'Please open the verification link sent to your email address before voting.',
    votes: votesList,
    isAdmin: Boolean(adminRow),
    adminRole: adminRow?.role || null,
  };
}

app.post('/api/auth/sync-identity', authLimiter, requireAuthenticatedUser, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient();
  const authUser = req.authUser;
  if (!adminClient || !authUser) {
    res.status(503).json({ error: 'Supabase service role credentials are not configured.' });
    return;
  }

  try {
    const identities = authUser.identities || [];
    const googleIdObj = identities.find((id) => id.provider === 'google');

    const googleProviderId = googleIdObj?.id || null;
    const googleEmail =
      ((googleIdObj?.identity_data?.email as string | undefined) || authUser.email || '').trim().toLowerCase() || null;
    const emailVerified = Boolean(googleIdObj?.identity_data?.email_verified ?? authUser.email_confirmed_at);

    if (googleProviderId) {
      const { data: conflictGoogle } = await adminClient
        .from('voter_identities')
        .select('id, auth_user_id')
        .eq('google_provider_id', googleProviderId)
        .neq('auth_user_id', authUser.id)
        .maybeSingle();
      if (conflictGoogle) {
        res.status(409).json({
          error: 'This Google account is already linked to another MultiCraft Awards voter identity.',
        });
        return;
      }
    }

    const displayName =
      (authUser.user_metadata?.full_name as string | undefined) ||
      (authUser.user_metadata?.name as string | undefined) ||
      googleEmail?.split('@')[0] ||
      'Community Voter';

    const { data: existingVoter } = await adminClient
      .from('voter_identities')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    let voterId = existingVoter?.id as string | undefined;

    if (!existingVoter) {
      const { data: inserted, error: insErr } = await adminClient
        .from('voter_identities')
        .insert({
          auth_user_id: authUser.id,
          google_provider_id: googleProviderId,
          google_email: googleEmail,
          google_email_verified: emailVerified,
          primary_provider: 'google',
          display_name: displayName,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      voterId = inserted.id;
    } else {
      const { error: updErr } = await adminClient
        .from('voter_identities')
        .update({
          google_provider_id: googleProviderId || existingVoter.google_provider_id,
          google_email: googleEmail || existingVoter.google_email,
          google_email_verified: emailVerified || existingVoter.google_email_verified,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingVoter.id);
      if (updErr) throw updErr;
      voterId = existingVoter.id;
    }

    if (voterId) {
      await adminClient.from('eligibility_records').upsert(
        {
          voter_identity_id: voterId,
          provider: 'google',
          status: emailVerified ? 'approved' : 'pending',
          decision_reason: emailVerified
            ? 'Verified email address.'
            : 'Pending email address verification.',
          reviewed_at: emailVerified ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'voter_identity_id,provider' }
      );
    }

    const yearId = typeof req.body?.yearId === 'string' ? req.body.yearId : null;
    const state = await buildVoterSessionState(authUser, yearId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to sync voter identity.' });
  }
});

app.get('/api/voter/me', requireAuthenticatedUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const yearId = typeof req.query.yearId === 'string' ? req.query.yearId : null;
    const state = await buildVoterSessionState(req.authUser!, yearId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load voter status.' });
  }
});

// ============================================================================
// SECURE VOTING ENDPOINT
// ============================================================================
app.post('/api/votes', voteLimiter, requireAuthenticatedUser, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient || !req.authUser) {
    res.status(503).json({ error: 'Supabase service role credentials are required for secure voting.' });
    return;
  }

  try {
    const { awardsYearId, categoryId, nomineeId, deviceFingerprint } = req.body as {
      awardsYearId?: string;
      categoryId?: string;
      nomineeId?: string;
      deviceFingerprint?: string;
    };

    if (!awardsYearId || !categoryId || !nomineeId) {
      res.status(400).json({ error: 'awardsYearId, categoryId, and nomineeId are required.' });
      return;
    }

    const sessionState = await buildVoterSessionState(req.authUser, awardsYearId);
    if (!sessionState.voter) {
      res.status(403).json({ error: 'Voter identity record is missing.' });
      return;
    }
    if (!sessionState.emailVerified) {
      res.status(403).json({ error: 'Verified email address is required before voting.' });
      return;
    }

    const [{ data: year }, { data: category }, { data: nominee }] = await Promise.all([
      adminClient.from('awards_years').select('*').eq('id', awardsYearId).single(),
      adminClient
        .from('categories')
        .select('*')
        .eq('id', categoryId)
        .eq('awards_year_id', awardsYearId)
        .single(),
      adminClient
        .from('nominees')
        .select('*')
        .eq('id', nomineeId)
        .eq('category_id', categoryId)
        .eq('awards_year_id', awardsYearId)
        .single(),
    ]);

    if (!year || year.status !== 'voting_active') {
      res.status(403).json({ error: 'Voting is not currently active for this awards year.' });
      return;
    }

    const now = Date.now();
    if (year.voting_starts_at && now < new Date(year.voting_starts_at).getTime()) {
      res.status(403).json({ error: 'Voting has not opened yet.' });
      return;
    }
    if (year.voting_ends_at && now > new Date(year.voting_ends_at).getTime()) {
      res.status(403).json({ error: 'Voting window has closed.' });
      return;
    }
    if (!category || !category.is_enabled) {
      res.status(400).json({ error: 'Selected category is not active.' });
      return;
    }
    if (!nominee || !nominee.is_active) {
      res.status(400).json({ error: 'Selected nominee is not active.' });
      return;
    }

    const fpHash = deviceFingerprint ? sha256Hex(deviceFingerprint) : null;
    const ipHash = sha256Hex(getClientIp(req));

    const { data: existingVote } = await adminClient
      .from('votes')
      .select('id, nominee_id')
      .eq('awards_year_id', awardsYearId)
      .eq('category_id', categoryId)
      .eq('voter_id', sessionState.voter.id)
      .maybeSingle();

    if (existingVote) {
      if (!year.allow_vote_editing) {
        res.status(409).json({
          error: 'You have already cast your vote in this category. Vote editing is disabled.',
        });
        return;
      }

      const { data: updatedVote, error: updErr } = await adminClient
        .from('votes')
        .update({
          nominee_id: nomineeId,
          device_fingerprint_hash: fpHash,
          ip_hash: ipHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingVote.id)
        .select('*')
        .single();

      if (updErr) throw updErr;
      res.json({ vote: updatedVote, updated: true });
      return;
    }

    const { data: insertedVote, error: insErr } = await adminClient
      .from('votes')
      .insert({
        awards_year_id: awardsYearId,
        category_id: categoryId,
        nominee_id: nomineeId,
        voter_id: sessionState.voter.id,
        device_fingerprint_hash: fpHash,
        ip_hash: ipHash,
      })
      .select('*')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        res.status(409).json({ error: 'Duplicate vote prevented by database constraint.' });
        return;
      }
      throw insErr;
    }

    res.status(201).json({ vote: insertedVote, updated: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit vote.' });
  }
});

// ============================================================================
// ADMIN BOOTSTRAP & MANAGEMENT API
// ============================================================================
app.post('/api/admin/bootstrap', requireAuthenticatedUser, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient || !req.authUser) {
    res.status(503).json({ error: 'Supabase service role credentials are not configured.' });
    return;
  }

  try {
    const { count, error: countErr } = await adminClient
      .from('administrator_roles')
      .select('id', { count: 'exact', head: true });

    if (countErr) throw countErr;
    if ((count || 0) > 0) {
      res.status(403).json({ error: 'Administrators already exist. Ask a super_admin to grant access.' });
      return;
    }

    const email = req.authUser.email || `${req.authUser.id}@auth.local`;
    const { data, error } = await adminClient
      .from('administrator_roles')
      .insert({
        auth_user_id: req.authUser.id,
        email,
        role: 'super_admin',
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser.id,
      actorEmail: email,
      action: 'BOOTSTRAP_SUPER_ADMIN',
      entityType: 'administrator_roles',
      entityId: data.id,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ role: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to bootstrap administrator.' });
  }
});

app.get('/api/admin/overview', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    await ensureCurrentCalendarYear();
    const yearId = typeof req.query.yearId === 'string' ? req.query.yearId : null;

    const [{ data: years }, { data: players }, { data: teams }, { data: eligibilities }, { data: adminRoles }, { data: auditLogs }] =
      await Promise.all([
        adminClient.from('awards_years').select('*').order('year_label', { ascending: false }),
        adminClient.from('players').select('*').order('player_name', { ascending: true }),
        adminClient
          .from('teams')
          .select('*, members:team_members(*, player:players(*))')
          .order('team_name', { ascending: true }),
        adminClient
          .from('eligibility_records')
          .select('*, voter:voter_identities(*)')
          .order('updated_at', { ascending: false }),
        adminClient.from('administrator_roles').select('*').order('created_at', { ascending: true }),
        adminClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ]);

    const yearsList = years || [];
    const targetYear =
      (yearId ? yearsList.find((y) => y.id === yearId) : null) ||
      yearsList.find((y) => y.is_active) ||
      yearsList[0] ||
      null;

    let categories: unknown[] = [];
    let nominees: unknown[] = [];
    let votesSummary: Array<{ category_id: string; nominee_id: string; count: number }> = [];
    let totalVotes = 0;
    let uniqueVoters = 0;
    let categoryResults: unknown[] = [];
    let overallRankings: unknown[] = [];

    if (targetYear) {
      const [{ data: cats }, { data: noms }, { data: votes }, { data: catRes }, { data: rankings }] =
        await Promise.all([
          adminClient
            .from('categories')
            .select('*, point_rules:category_point_rules(*)')
            .eq('awards_year_id', targetYear.id)
            .order('display_order', { ascending: true }),
          adminClient
            .from('nominees')
            .select('*, player:players(*), team:teams(*, members:team_members(*, player:players(*)))')
            .eq('awards_year_id', targetYear.id)
            .order('display_name', { ascending: true }),
          adminClient
            .from('votes')
            .select('category_id, nominee_id, voter_id')
            .eq('awards_year_id', targetYear.id),
          adminClient
            .from('category_results')
            .select('*, nominee:nominees(*)')
            .eq('awards_year_id', targetYear.id)
            .order('position', { ascending: true }),
          adminClient
            .from('overall_rankings')
            .select('*, player:players(*)')
            .eq('awards_year_id', targetYear.id)
            .order('rank_position', { ascending: true }),
        ]);

      categories = (cats || []).map((c) => ({
        ...c,
        point_rules: (c.point_rules || []).sort(
          (a: { position: number }, b: { position: number }) => a.position - b.position
        ),
      }));
      nominees = noms || [];
      categoryResults = catRes || [];
      overallRankings = rankings || [];

      const voteList = votes || [];
      totalVotes = voteList.length;
      uniqueVoters = new Set(voteList.map((v) => v.voter_id)).size;

      const countsMap = new Map<string, number>();
      for (const v of voteList) {
        const key = `${v.category_id}::${v.nominee_id}`;
        countsMap.set(key, (countsMap.get(key) || 0) + 1);
      }
      votesSummary = Array.from(countsMap.entries()).map(([k, count]) => {
        const [category_id, nominee_id] = k.split('::');
        return { category_id, nominee_id, count };
      });
    }

    res.json({
      years: yearsList,
      selectedYear: targetYear,
      categories,
      players: players || [],
      teams: teams || [],
      nominees,
      eligibilities: eligibilities || [],
      votesSummary,
      stats: {
        totalVotes,
        uniqueVoters,
        pendingEligibilities: (eligibilities || []).filter((e) => e.status === 'pending').length,
        totalPlayers: (players || []).length,
        totalCategories: categories.length,
        totalNominees: nominees.length,
      },
      categoryResults,
      overallRankings,
      adminRoles: adminRoles || [],
      auditLogs: auditLogs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load admin overview.' });
  }
});

// --- Awards Years ---
app.post('/api/admin/years', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { year_label, title, description, voting_starts_at, voting_ends_at, tie_policy, is_active, seedDefaults } =
      req.body;

    if (is_active) {
      await adminClient.from('awards_years').update({ is_active: false }).neq('year_label', -1);
    }

    const { data: year, error } = await adminClient
      .from('awards_years')
      .insert({
        year_label: Number(year_label),
        title,
        description: description || '',
        voting_starts_at: voting_starts_at || null,
        voting_ends_at: voting_ends_at || null,
        status: 'draft',
        tie_policy: tie_policy || 'shared_rank',
        is_active: Boolean(is_active),
      })
      .select('*')
      .single();

    if (error) throw error;

    if (seedDefaults) {
      for (const bp of DEFAULT_CATEGORY_BLUEPRINTS) {
        const { data: cat } = await adminClient
          .from('categories')
          .insert({
            awards_year_id: year.id,
            slug: bp.slug,
            name: bp.name,
            description: bp.description,
            icon_name: bp.icon_name,
            display_order: bp.display_order,
            winning_positions_count: bp.winning_positions_count,
            is_enabled: true,
            is_team_category: bp.is_team_category,
          })
          .select('*')
          .single();

        if (cat) {
          await adminClient.from('category_point_rules').insert(
            bp.point_rules.map((r) => ({
              category_id: cat.id,
              position: r.position,
              points: r.points,
            }))
          );
        }
      }
    }

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'CREATE_AWARDS_YEAR',
      entityType: 'awards_years',
      entityId: year.id,
      details: { year_label: year.year_label, seedDefaults: Boolean(seedDefaults) },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ year });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create awards year.' });
  }
});

app.patch('/api/admin/years/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const payload = { ...req.body, updated_at: new Date().toISOString() };

    if (payload.is_active === true) {
      await adminClient.from('awards_years').update({ is_active: false }).neq('id', id);
    }

    const { data, error } = await adminClient
      .from('awards_years')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPDATE_AWARDS_YEAR',
      entityType: 'awards_years',
      entityId: id,
      details: payload,
      ipAddress: getClientIp(req),
    });

    res.json({ year: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update awards year.' });
  }
});

// --- Categories & Dynamic Point Rules ---
app.post('/api/admin/categories', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const {
      awards_year_id,
      name,
      description,
      icon_url,
      icon_name,
      display_order,
      winning_positions_count,
      is_enabled,
      is_team_category,
      point_rules,
    } = req.body;

    const slug = `${String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36).slice(-4)}`;

    const { data: cat, error } = await adminClient
      .from('categories')
      .insert({
        awards_year_id,
        slug,
        name,
        description: description || '',
        icon_url: icon_url || null,
        icon_name: icon_name || 'Trophy',
        display_order: Number(display_order ?? 1),
        winning_positions_count: Number(winning_positions_count ?? 3),
        is_enabled: is_enabled ?? true,
        is_team_category: Boolean(is_team_category),
      })
      .select('*')
      .single();

    if (error) throw error;

    const rules: Array<{ position: number; points: number }> = Array.isArray(point_rules)
      ? point_rules
      : [
          { position: 1, points: 5 },
          { position: 2, points: 2 },
          { position: 3, points: 3 },
        ];

    if (rules.length > 0) {
      await adminClient.from('category_point_rules').insert(
        rules.map((r) => ({
          category_id: cat.id,
          position: Number(r.position),
          points: Number(r.points),
        }))
      );
    }

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'CREATE_CATEGORY',
      entityType: 'categories',
      entityId: cat.id,
      details: { name, winning_positions_count },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ category: cat });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create category.' });
  }
});

app.put('/api/admin/categories/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const {
      name,
      description,
      icon_url,
      icon_name,
      display_order,
      winning_positions_count,
      is_enabled,
      is_team_category,
      point_rules,
    } = req.body;

    const { data: cat, error } = await adminClient
      .from('categories')
      .update({
        name,
        description,
        icon_url: icon_url ?? null,
        icon_name: icon_name || 'Trophy',
        display_order: Number(display_order),
        winning_positions_count: Number(winning_positions_count),
        is_enabled: Boolean(is_enabled),
        is_team_category: Boolean(is_team_category),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    if (Array.isArray(point_rules)) {
      await adminClient.from('category_point_rules').delete().eq('category_id', id);
      if (point_rules.length > 0) {
        await adminClient.from('category_point_rules').insert(
          point_rules.map((r: { position: number; points: number }) => ({
            category_id: id,
            position: Number(r.position),
            points: Number(r.points),
          }))
        );
      }
    }

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPDATE_CATEGORY',
      entityType: 'categories',
      entityId: id,
      details: { name, winning_positions_count, is_enabled },
      ipAddress: getClientIp(req),
    });

    res.json({ category: cat });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update category.' });
  }
});

app.post('/api/admin/categories/reorder', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const orderedIds = (req.body.orderedIds || []) as string[];
    for (let i = 0; i < orderedIds.length; i += 1) {
      await adminClient
        .from('categories')
        .update({ display_order: i + 1 })
        .eq('id', orderedIds[i]);
    }
    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'REORDER_CATEGORIES',
      entityType: 'categories',
      details: { orderedIds },
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reorder categories.' });
  }
});

app.delete('/api/admin/categories/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const { error } = await adminClient.from('categories').delete().eq('id', id);
    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'DELETE_CATEGORY',
      entityType: 'categories',
      entityId: id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete category.' });
  }
});

// --- Players & 3D Skins ---
app.post('/api/admin/players', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { player_name, avatar_url, bio, social_links, skin_url, skin_model } = req.body;
    const unique_slug = `${String(player_name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36).slice(-4)}`;

    const { data, error } = await adminClient
      .from('players')
      .insert({
        player_name,
        unique_slug,
        avatar_url: avatar_url || null,
        bio: bio || '',
        social_links: social_links || {},
        skin_url: skin_url || null,
        skin_model: skin_model === 'slim' ? 'slim' : 'classic',
      })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'CREATE_PLAYER',
      entityType: 'players',
      entityId: data.id,
      details: { player_name },
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ player: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create player.' });
  }
});

app.put('/api/admin/players/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const { player_name, avatar_url, bio, social_links, skin_url, skin_model } = req.body;
    const { data, error } = await adminClient
      .from('players')
      .update({
        player_name,
        avatar_url: avatar_url ?? null,
        bio: bio ?? '',
        social_links: social_links ?? {},
        skin_url: skin_url ?? null,
        skin_model: skin_model === 'slim' ? 'slim' : 'classic',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    // Keep linked nominee snapshots synchronized
    await adminClient
      .from('nominees')
      .update({
        display_name: player_name,
        profile_image_url: avatar_url ?? null,
        skin_url: skin_url ?? null,
        skin_model: skin_model === 'slim' ? 'slim' : 'classic',
        updated_at: new Date().toISOString(),
      })
      .eq('player_id', id);

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPDATE_PLAYER',
      entityType: 'players',
      entityId: id,
      details: { player_name, skin_model },
      ipAddress: getClientIp(req),
    });
    res.json({ player: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update player.' });
  }
});

app.delete('/api/admin/players/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { error } = await adminClient.from('players').delete().eq('id', req.params.id);
    if (error) throw error;
    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'DELETE_PLAYER',
      entityType: 'players',
      entityId: req.params.id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete player.' });
  }
});

// --- Teams & Team Members ---
app.post('/api/admin/teams', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { team_name, avatar_url, description, social_links, member_player_ids } = req.body;
    const unique_slug = `${String(team_name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36).slice(-4)}`;

    const { data: team, error } = await adminClient
      .from('teams')
      .insert({
        team_name,
        unique_slug,
        avatar_url: avatar_url || null,
        description: description || '',
        social_links: social_links || {},
      })
      .select('*')
      .single();

    if (error) throw error;

    if (Array.isArray(member_player_ids) && member_player_ids.length > 0) {
      await adminClient.from('team_members').insert(
        member_player_ids.map((playerId: string) => ({
          team_id: team.id,
          player_id: playerId,
        }))
      );
    }

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'CREATE_TEAM',
      entityType: 'teams',
      entityId: team.id,
      details: { team_name, memberCount: member_player_ids?.length || 0 },
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ team });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create team.' });
  }
});

app.put('/api/admin/teams/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const { team_name, avatar_url, description, social_links, member_player_ids } = req.body;
    const { data: team, error } = await adminClient
      .from('teams')
      .update({
        team_name,
        avatar_url: avatar_url ?? null,
        description: description ?? '',
        social_links: social_links ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    if (Array.isArray(member_player_ids)) {
      await adminClient.from('team_members').delete().eq('team_id', id);
      if (member_player_ids.length > 0) {
        await adminClient.from('team_members').insert(
          member_player_ids.map((playerId: string) => ({
            team_id: id,
            player_id: playerId,
          }))
        );
      }
    }

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPDATE_TEAM',
      entityType: 'teams',
      entityId: id,
      details: { team_name },
      ipAddress: getClientIp(req),
    });
    res.json({ team });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update team.' });
  }
});

app.delete('/api/admin/teams/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { error } = await adminClient.from('teams').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete team.' });
  }
});

// --- Nominees ---
app.post('/api/admin/nominees', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { awards_year_id, category_id, nominee_type, player_id, team_id, description } = req.body;

    let display_name = '';
    let profile_image_url: string | null = null;
    let social_links = {};
    let skin_url: string | null = null;
    let skin_model: 'classic' | 'slim' = 'classic';
    let resolvedDesc = description || '';

    if (nominee_type === 'player' && player_id) {
      const { data: player, error: pErr } = await adminClient
        .from('players')
        .select('*')
        .eq('id', player_id)
        .single();
      if (pErr || !player) {
        res.status(404).json({ error: 'Referenced player not found.' });
        return;
      }
      display_name = player.player_name;
      profile_image_url = player.avatar_url;
      social_links = player.social_links || {};
      skin_url = player.skin_url;
      skin_model = player.skin_model;
      if (!resolvedDesc) resolvedDesc = player.bio || '';
    } else if (nominee_type === 'team' && team_id) {
      const { data: team, error: tErr } = await adminClient
        .from('teams')
        .select('*')
        .eq('id', team_id)
        .single();
      if (tErr || !team) {
        res.status(404).json({ error: 'Referenced team not found.' });
        return;
      }
      display_name = team.team_name;
      profile_image_url = team.avatar_url;
      social_links = team.social_links || {};
      if (!resolvedDesc) resolvedDesc = team.description || '';
    } else {
      res.status(400).json({ error: 'Invalid nominee type or missing player/team reference.' });
      return;
    }

    const { data, error } = await adminClient
      .from('nominees')
      .insert({
        awards_year_id,
        category_id,
        nominee_type,
        player_id: nominee_type === 'player' ? player_id : null,
        team_id: nominee_type === 'team' ? team_id : null,
        display_name,
        description: resolvedDesc,
        profile_image_url,
        social_links,
        skin_url,
        skin_model,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'CREATE_NOMINEE',
      entityType: 'nominees',
      entityId: data.id,
      details: { display_name, category_id },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ nominee: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create nominee.' });
  }
});

app.delete('/api/admin/nominees/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { error } = await adminClient.from('nominees').delete().eq('id', req.params.id);
    if (error) throw error;
    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'DELETE_NOMINEE',
      entityType: 'nominees',
      entityId: req.params.id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete nominee.' });
  }
});

// --- Supabase Storage Upload for Skins, Icons, Avatars ---
app.post('/api/admin/storage/upload', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const { bucket, fileName, contentType, base64Data } = req.body as {
      bucket: 'player-skins' | 'category-icons' | 'avatars';
      fileName: string;
      contentType: string;
      base64Data: string;
    };

    if (!['player-skins', 'category-icons', 'avatars'].includes(bucket)) {
      res.status(400).json({ error: 'Invalid storage bucket.' });
      return;
    }

    const base64Clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(base64Clean, 'base64');
    if (buffer.length > 4 * 1024 * 1024) {
      res.status(400).json({ error: 'File exceeds 4MB limit.' });
      return;
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${Date.now()}-${safeName}`;

    const { error: uploadErr } = await adminClient.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: contentType || 'image/png',
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    const { data: publicUrlData } = adminClient.storage.from(bucket).getPublicUrl(storagePath);

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPLOAD_STORAGE_ASSET',
      entityType: 'storage',
      entityId: storagePath,
      details: { bucket, contentType },
      ipAddress: getClientIp(req),
    });

    res.json({ url: publicUrlData.publicUrl, path: storagePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to upload asset to Supabase Storage.' });
  }
});

// --- Manual Eligibility Verification (Google Account Age Review) ---
app.patch('/api/admin/eligibility/:id', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    const id = req.params.id;
    const { status, decision_reason, calculated_age_days } = req.body;

    if (!['pending', 'approved', 'rejected', 'ineligible'].includes(status)) {
      res.status(400).json({ error: 'Invalid eligibility status.' });
      return;
    }

    const { data, error } = await adminClient
      .from('eligibility_records')
      .update({
        status,
        decision_reason: decision_reason || null,
        calculated_age_days: calculated_age_days !== undefined ? Number(calculated_age_days) : null,
        reviewed_by: req.authUser?.id || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'REVIEW_ELIGIBILITY',
      entityType: 'eligibility_records',
      entityId: id,
      details: { status, decision_reason },
      ipAddress: getClientIp(req),
    });

    res.json({ eligibility: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update eligibility decision.' });
  }
});

// --- Calculate & Publish Results ---
app.post(
  '/api/admin/years/:yearId/calculate-results',
  requireAdministrator,
  async (req: AuthenticatedRequest, res: Response) => {
    const adminClient = getSupabaseAdminClient()!;
    try {
      const yearId = req.params.yearId;
      const summary = await calculateAwardsYearResults(adminClient, yearId);

      await writeAuditLog({
        actorUserId: req.authUser?.id,
        actorEmail: req.adminRole?.email,
        action: 'CALCULATE_RESULTS',
        entityType: 'awards_years',
        entityId: yearId,
        details: summary,
        ipAddress: getClientIp(req),
      });

      res.json({ ok: true, ...summary });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to calculate winners and rankings.' });
    }
  }
);

app.post(
  '/api/admin/years/:yearId/publish',
  requireAdministrator,
  async (req: AuthenticatedRequest, res: Response) => {
    const adminClient = getSupabaseAdminClient()!;
    try {
      const yearId = req.params.yearId;
      const summary = await calculateAwardsYearResults(adminClient, yearId);

      const { data: year, error } = await adminClient
        .from('awards_years')
        .update({ status: 'results_published', updated_at: new Date().toISOString() })
        .eq('id', yearId)
        .select('*')
        .single();

      if (error) throw error;

      await writeAuditLog({
        actorUserId: req.authUser?.id,
        actorEmail: req.adminRole?.email,
        action: 'PUBLISH_RESULTS',
        entityType: 'awards_years',
        entityId: yearId,
        details: summary,
        ipAddress: getClientIp(req),
      });

      res.json({ ok: true, year, ...summary });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish results.' });
    }
  }
);

// --- Administrator Roles ---
app.post('/api/admin/roles', requireAdministrator, async (req: AuthenticatedRequest, res: Response) => {
  const adminClient = getSupabaseAdminClient()!;
  try {
    if (req.adminRole?.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super_admin can add or modify administrator roles.' });
      return;
    }

    const { email, role } = req.body;
    const { data, error } = await adminClient
      .from('administrator_roles')
      .upsert(
        {
          email: String(email).trim().toLowerCase(),
          role: ['super_admin', 'awards_admin', 'moderator'].includes(role) ? role : 'awards_admin',
          is_active: true,
        },
        { onConflict: 'email' }
      )
      .select('*')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.authUser?.id,
      actorEmail: req.adminRole?.email,
      action: 'UPSERT_ADMIN_ROLE',
      entityType: 'administrator_roles',
      entityId: data.id,
      details: { email, role },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ role: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to manage administrator role.' });
  }
});

// --- Setup Assistant Helpers ---
app.get('/api/public/setup-sql', (_req: Request, res: Response) => {
  try {
    const sqlPath = path.join(__dirname, 'supabase', 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    res.json({ sql });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to read SQL schema.' });
  }
});

app.get('/api/public/db-check', async (_req: Request, res: Response) => {
  const configured = isServerSupabaseConfigured();
  const serviceRole = hasServiceRoleKey();
  const db = getSupabaseAdminClient() || getSupabasePublicClient();
  if (!configured || !db) {
    res.json({ configured, serviceRole, tablesReady: false });
    return;
  }
  const { error } = await db.from('awards_years').select('id').limit(1);
  res.json({
    configured,
    serviceRole,
    tablesReady: !error,
    errorMessage: error?.message || null,
  });
});

// ============================================================================
// SEO, SITEMAP, ROBOTS & AI/LLM DISCOVERY ROUTES
// ============================================================================
const SEO_DISCOVERY_FILES: Record<string, string> = {
  '/robots.txt': 'text/plain; charset=utf-8',
  '/sitemap.xml': 'application/xml; charset=utf-8',
  '/llms.txt': 'text/plain; charset=utf-8',
  '/llms-full.txt': 'text/plain; charset=utf-8',
};

for (const [routePath, contentType] of Object.entries(SEO_DISCOVERY_FILES)) {
  app.get(routePath, (req: Request, res: Response) => {
    const fileName = routePath.replace(/^\//, '');
    const candidates = [
      path.join(__dirname, 'public', fileName),
      path.join(__dirname, 'dist', fileName),
    ];
    const targetFile = candidates.find((p) => fs.existsSync(p));
    if (!targetFile) {
      res.status(404).send('Not found');
      return;
    }

    const origin = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const content = fs.readFileSync(targetFile, 'utf-8').replace(/__SITE_ORIGIN__/g, origin);
    res.setHeader('Content-Type', contentType);
    res.send(content);
  });
}

// ============================================================================
// VITE / STATIC SERVING ON PORT 3000
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MultiCraft Awards server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
