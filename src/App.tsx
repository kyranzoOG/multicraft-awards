import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  completeOAuthFromParams,
  fetchStaticPublicBootstrap,
  getDefaultCalendarYearBlueprint,
  getSupabaseClient,
} from './lib/supabase';
import { getDeviceFingerprintHash } from './lib/fingerprint';
import { MainHomePage } from './components/MainHomePage';
import { CategoriesPage } from './components/CategoriesPage';
import { VotingPage } from './components/VotingPage';
import { WinnersPage } from './components/WinnersPage';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthEligibilityModal } from './components/AuthEligibilityModal';
import { PlayerProfileModal } from './components/PlayerProfileModal';
import type {
  Nominee,
  OverallRanking,
  PublicBootstrapPayload,
  VoterSessionState,
} from './types/awards';

type AppRoute = 'home' | 'categories' | 'vote' | 'winners' | 'admin';

function getAppBasePath(): string {
  const raw = import.meta.env.BASE_URL || '/';
  const cleaned = raw.replace(/\/+$/, '');
  return cleaned === '' ? '' : cleaned;
}

function stripBasePath(pathname: string): string {
  const base = getAppBasePath();
  let relative = pathname;
  if (base && relative.startsWith(base)) {
    relative = relative.slice(base.length) || '/';
  }
  return relative.replace(/\/+$/, '') || '/';
}

function parseRouteFromPath(pathname: string): AppRoute {
  const clean = stripBasePath(pathname);
  if (clean === '/categories') return 'categories';
  if (clean === '/vote') return 'vote';
  if (clean === '/winners') return 'winners';
  if (clean === '/admin') return 'admin';
  return 'home';
}

function routeToPath(route: AppRoute): string {
  const base = getAppBasePath();
  switch (route) {
    case 'categories':
      return `${base}/categories`;
    case 'vote':
      return `${base}/vote`;
    case 'winners':
      return `${base}/winners`;
    case 'admin':
      return `${base}/admin`;
    default:
      return `${base}/`;
  }
}

const EMPTY_VOTER_SESSION: VoterSessionState = {
  voter: null,
  eligibilities: [],
  emailVerified: false,
  overallEligible: false,
  eligibilitySummary: 'Sign in with Google or email to verify your email address.',
  votes: [],
  isAdmin: false,
  adminRole: null,
};

export default function App() {
  // Handle both popup callback relays and direct same-tab OAuth/email verification redirects
  useEffect(() => {
    const isCallbackPath = stripBasePath(window.location.pathname) === '/auth/callback';
    const hasOAuthParams =
      window.location.search.includes('code=') ||
      window.location.hash.includes('access_token=') ||
      window.location.search.includes('error=') ||
      window.location.hash.includes('error=');

    if (isCallbackPath && window.opener && !window.opener.closed) {
      const payload = {
        type: 'MULTICRAFT_OAUTH_CALLBACK',
        hash: window.location.hash || '',
        search: window.location.search || '',
        ts: Date.now(),
      };
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const ch = new BroadcastChannel('multicraft_oauth_channel');
          ch.postMessage(payload);
          ch.close();
        }
      } catch {
        // Ignore channel errors
      }
      try {
        window.localStorage.setItem('mc_oauth_callback', JSON.stringify(payload));
      } catch {
        // Ignore storage errors
      }
      window.opener.postMessage(payload, window.location.origin);
      window.close();
      return;
    }

    if (hasOAuthParams) {
      void completeOAuthFromParams(window.location.search, window.location.hash)
        .then((completed) => {
          if (completed) {
            const targetPath = isCallbackPath ? routeToPath('home') : window.location.pathname;
            window.history.replaceState({}, '', targetPath);
          }
        })
        .catch(() => {
          // Ignore malformed callback params
        });
    }
  }, []);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = window.localStorage.getItem('mc_awards_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  const [route, setRoute] = useState<AppRoute>(() => parseRouteFromPath(window.location.pathname));
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);

  const [bootstrap, setBootstrap] = useState<PublicBootstrapPayload>(() => getDefaultCalendarYearBlueprint());
  const [loadingPublic, setLoadingPublic] = useState<boolean>(true);
  const [voterSession, setVoterSession] = useState<VoterSessionState>(EMPTY_VOTER_SESSION);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<{
    nominee: Nominee | null;
    ranking: OverallRanking | null;
  } | null>(null);

  const navigate = useCallback((nextRoute: AppRoute, categoryId?: string) => {
    if (categoryId) setSelectedCategoryId(categoryId);
    setRoute(nextRoute);
    const targetPath = routeToPath(nextRoute);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRouteFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('mc_awards_theme', theme);
    } catch {
      // Ignore storage failure
    }
  }, [theme]);

  const loadPublicBootstrap = useCallback(
    async (yearIdOverride?: string | null) => {
      setLoadingPublic(true);
      try {
        const targetYear = yearIdOverride ?? selectedYearId;
        const url = targetYear
          ? `/api/public/bootstrap?yearId=${encodeURIComponent(targetYear)}`
          : '/api/public/bootstrap';
        const res = await fetch(url);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as PublicBootstrapPayload;
          setBootstrap(data);
          if (!targetYear && data.selectedYear?.id) {
            setSelectedYearId(data.selectedYear.id);
          }
          return;
        }
        throw new Error('Static host mode');
      } catch {
        const fallbackData = await fetchStaticPublicBootstrap(yearIdOverride ?? selectedYearId);
        setBootstrap(fallbackData);
        if (!(yearIdOverride ?? selectedYearId) && fallbackData.selectedYear?.id) {
          setSelectedYearId(fallbackData.selectedYear.id);
        }
      } finally {
        setLoadingPublic(false);
      }
    },
    [selectedYearId]
  );

  const loadVoterSession = useCallback(
    async (yearId?: string | null) => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setVoterSession(EMPTY_VOTER_SESSION);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const token = session?.access_token;
      if (!token || !session?.user) {
        setVoterSession(EMPTY_VOTER_SESSION);
        return;
      }

      const activeYear = yearId ?? bootstrap.selectedYear?.id ?? selectedYearId;
      const query = activeYear ? `?yearId=${encodeURIComponent(activeYear)}` : '';

      try {
        const res = await fetch(`/api/voter/me${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const contentType = res.headers.get('content-type') || '';

        if (res.ok && contentType.includes('application/json')) {
          const state = (await res.json()) as VoterSessionState;
          if (!state.voter) {
            const syncRes = await fetch('/api/auth/sync-identity', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ yearId: activeYear }),
            });
            if (syncRes.ok) {
              setVoterSession((await syncRes.json()) as VoterSessionState);
              return;
            }
          }
          setVoterSession(state);
          return;
        }
      } catch {
        // Fall back to direct Supabase auth session on static hosting
      }

      const authUser = session.user;
      const email = (authUser.email || '').trim().toLowerCase();
      const emailVerified = Boolean(authUser.email_confirmed_at);
      const displayName =
        (authUser.user_metadata?.full_name as string | undefined) ||
        (authUser.user_metadata?.name as string | undefined) ||
        email.split('@')[0] ||
        'Community Member';

      let isAdmin = false;
      let adminRole: 'super_admin' | 'awards_admin' | 'moderator' | null = null;
      if (email) {
        try {
          const { data: roleData } = await supabase
            .from('administrator_roles')
            .select('role, is_active')
            .eq('email', email)
            .eq('is_active', true)
            .maybeSingle();
          if (roleData) {
            isAdmin = true;
            adminRole = roleData.role;
          }
        } catch {
          // Ignore RLS denial for non-admins
        }
      }

      const nowIso = new Date().toISOString();
      let resolvedVoter: NonNullable<VoterSessionState['voter']> = {
        id: authUser.id,
        auth_user_id: authUser.id,
        google_provider_id: null,
        google_email: email || null,
        google_email_verified: emailVerified,
        discord_provider_id: null,
        discord_username: null,
        discord_email: null,
        discord_email_verified: false,
        discord_created_at: null,
        primary_provider: 'google',
        display_name: displayName,
        created_at: authUser.created_at || nowIso,
        updated_at: nowIso,
      };
      let staticVotes: VoterSessionState['votes'] = [];

      try {
        const { data: existingVoter } = await supabase
          .from('voter_identities')
          .select('*')
          .eq('auth_user_id', authUser.id)
          .maybeSingle();

        if (existingVoter) {
          resolvedVoter = existingVoter;
        } else {
          const { data: insertedVoter } = await supabase
            .from('voter_identities')
            .upsert(
              {
                auth_user_id: authUser.id,
                google_email: email || null,
                google_email_verified: emailVerified,
                primary_provider: 'google',
                display_name: displayName,
              },
              { onConflict: 'auth_user_id' }
            )
            .select('*')
            .maybeSingle();
          if (insertedVoter) {
            resolvedVoter = insertedVoter;
          }
        }

        if (activeYear && resolvedVoter.id) {
          const { data: votesData } = await supabase
            .from('votes')
            .select('id, awards_year_id, category_id, nominee_id, voter_id, created_at, updated_at')
            .eq('awards_year_id', activeYear)
            .eq('voter_id', resolvedVoter.id);
          if (votesData) {
            staticVotes = votesData;
          }
        }
      } catch {
        // Fallback silently if RLS restricts write before setup
      }

      setVoterSession({
        voter: resolvedVoter,
        eligibilities: [],
        emailVerified,
        overallEligible: emailVerified,
        eligibilitySummary: emailVerified
          ? 'Email verified and eligible to vote.'
          : 'Please open the verification link sent to your email address.',
        votes: staticVotes,
        isAdmin,
        adminRole,
      });
    },
    [bootstrap.selectedYear?.id, selectedYearId]
  );

  useEffect(() => {
    loadPublicBootstrap();
  }, [selectedYearId]);

  useEffect(() => {
    loadVoterSession(bootstrap.selectedYear?.id);
  }, [bootstrap.selectedYear?.id]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void loadVoterSession(bootstrap.selectedYear?.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadVoterSession, bootstrap.selectedYear?.id]);

  const handleCastVote = async (categoryId: string, nomineeId: string) => {
    const supabase = getSupabaseClient();
    const session = (await supabase?.auth.getSession())?.data.session;
    if (!supabase || !session?.access_token || !bootstrap.selectedYear) {
      throw new Error('Please sign in with a verified email before voting.');
    }

    const deviceFingerprint = await getDeviceFingerprintHash();
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          awardsYearId: bootstrap.selectedYear.id,
          categoryId,
          nomineeId,
          deviceFingerprint,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Vote submission rejected.');
        }
        await loadVoterSession(bootstrap.selectedYear.id);
        return;
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('Failed to fetch')) {
        throw err;
      }
    }

    // Static GitHub Pages fallback using authenticated Supabase RLS
    const authUser = session.user;
    const email = (authUser.email || '').trim().toLowerCase();
    const emailVerified = Boolean(authUser.email_confirmed_at);
    if (!emailVerified) {
      throw new Error('Please verify your email address before casting a vote.');
    }

    const displayName =
      (authUser.user_metadata?.full_name as string | undefined) ||
      (authUser.user_metadata?.name as string | undefined) ||
      email.split('@')[0] ||
      'Community Voter';

    const { data: voterRow, error: voterErr } = await supabase
      .from('voter_identities')
      .upsert(
        {
          auth_user_id: authUser.id,
          google_email: email || null,
          google_email_verified: emailVerified,
          primary_provider: 'google',
          display_name: displayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'auth_user_id' }
      )
      .select('id')
      .single();

    if (voterErr || !voterRow) {
      throw new Error(voterErr?.message || 'Unable to verify voter profile.');
    }

    const { data: existingVote } = await supabase
      .from('votes')
      .select('id')
      .eq('awards_year_id', bootstrap.selectedYear.id)
      .eq('category_id', categoryId)
      .eq('voter_id', voterRow.id)
      .maybeSingle();

    if (existingVote) {
      if (!bootstrap.selectedYear.allow_vote_editing) {
        throw new Error('You have already voted in this category for this edition.');
      }
      const { error: updErr } = await supabase
        .from('votes')
        .update({
          nominee_id: nomineeId,
          device_fingerprint_hash: deviceFingerprint,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingVote.id);
      if (updErr) throw new Error(updErr.message || 'Unable to update your vote.');
    } else {
      const { error: insErr } = await supabase.from('votes').insert({
        awards_year_id: bootstrap.selectedYear.id,
        category_id: categoryId,
        nominee_id: nomineeId,
        voter_id: voterRow.id,
        device_fingerprint_hash: deviceFingerprint,
      });
      if (insErr) throw new Error(insErr.message || 'Unable to record vote.');
    }

    await loadVoterSession(bootstrap.selectedYear.id);
  };

  return (
    <div className="min-h-screen bg-[var(--mc-bg)] text-[var(--mc-ink)] transition-colors duration-150">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--mc-border)] bg-[var(--mc-header-bg)]">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Title */}
          <button
            type="button"
            onClick={() => navigate('home')}
            className="font-display text-lg font-bold tracking-tight text-[var(--mc-ink)] whitespace-nowrap shrink-0"
          >
            MultiCraft Awards
          </button>

          {/* Zone 2: Public Navigation Only (Vote & Admin accessible via direct URL /vote and /admin) */}
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-6 text-sm font-medium md:flex"
          >
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'categories', label: 'Categories' },
                { id: 'winners', label: 'Winners' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`transition-colors whitespace-nowrap shrink-0 ${
                  route === item.id
                    ? 'font-semibold text-[var(--mc-accent)]'
                    : 'text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--mc-accent)] px-4 text-xs font-semibold text-[var(--mc-accent-contrast)] transition-colors hover:bg-[var(--mc-accent-hover)] whitespace-nowrap shrink-0"
            >
              {voterSession.voter ? voterSession.voter.display_name : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b border-[var(--mc-border)] bg-[var(--mc-surface)] px-4 py-2 text-xs font-medium md:hidden">
        {(
          [
            { id: 'home', label: 'Home' },
            { id: 'categories', label: 'Categories' },
            { id: 'winners', label: 'Winners' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            className={`whitespace-nowrap shrink-0 px-2 py-1 ${
              route === item.id ? 'font-semibold text-[var(--mc-accent)]' : 'text-[var(--mc-ink-muted)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Dedicated Separate Pages */}
      {route === 'home' && (
        <MainHomePage
          selectedYear={bootstrap.selectedYear}
          categories={bootstrap.categories}
          nominees={bootstrap.nominees}
          resultsPublished={bootstrap.resultsPublished}
          categoryResults={bootstrap.categoryResults}
          loading={loadingPublic}
          onGoToCategory={(catId) => navigate('categories', catId)}
          onInspectNominee={(nominee) => setProfileTarget({ nominee, ranking: null })}
        />
      )}

      {route === 'categories' && (
        <CategoriesPage
          selectedYear={bootstrap.selectedYear}
          categories={bootstrap.categories}
          nominees={bootstrap.nominees}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          onInspectNominee={(nominee) => setProfileTarget({ nominee, ranking: null })}
        />
      )}

      {route === 'vote' && (
        <VotingPage
          selectedYear={bootstrap.selectedYear}
          categories={bootstrap.categories}
          nominees={bootstrap.nominees}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          voterSession={voterSession}
          onOpenAuthModal={() => setAuthModalOpen(true)}
          onInspectNominee={(nominee) => setProfileTarget({ nominee, ranking: null })}
          onCastVote={handleCastVote}
        />
      )}

      {route === 'winners' && (
        <WinnersPage
          years={bootstrap.years}
          selectedYear={bootstrap.selectedYear}
          onSelectYear={setSelectedYearId}
          categories={bootstrap.categories}
          resultsPublished={bootstrap.resultsPublished}
          categoryResults={bootstrap.categoryResults}
          overallRankings={bootstrap.overallRankings}
          onInspectProfile={(nominee, ranking = null) => setProfileTarget({ nominee, ranking })}
        />
      )}

      {route === 'admin' && (
        <AdminDashboard
          voterSession={voterSession}
          theme={theme}
          onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          onOpenAuthModal={() => setAuthModalOpen(true)}
          onPublicRefresh={() => loadPublicBootstrap(selectedYearId)}
          onSessionUpdated={() => loadVoterSession(bootstrap.selectedYear?.id)}
        />
      )}

      {/* Quiet Footer with Theme Switcher */}
      <footer className="mt-16 border-t border-[var(--mc-border)] bg-[var(--mc-surface)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-[var(--mc-ink-muted)] sm:px-6 lg:px-8">
          <span>MultiCraft Awards · Build & Mine Community</span>
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            className="inline-flex items-center gap-1.5 font-medium text-[var(--mc-ink)] hover:text-[var(--mc-accent)]"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </footer>

      <AuthEligibilityModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        voterSession={voterSession}
        activeYearId={bootstrap.selectedYear?.id || null}
        onSessionUpdated={() => loadVoterSession(bootstrap.selectedYear?.id)}
      />

      <PlayerProfileModal
        open={Boolean(profileTarget)}
        onClose={() => setProfileTarget(null)}
        nominee={profileTarget?.nominee || null}
        ranking={profileTarget?.ranking || null}
        categories={bootstrap.categories}
        resultsPublished={bootstrap.resultsPublished}
      />
    </div>
  );
}
