import { getSupabaseClient } from './supabase';
import type {
  AdministratorRole,
  AuditLog,
  AwardsYear,
  Category,
  CategoryResult,
  Nominee,
  OverallRanking,
  Player,
  SkinModel,
  Team,
} from '../types/awards';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `item-${Date.now()}`;
}

export async function apiOrStaticFallback<T>(
  apiCall: () => Promise<Response>,
  staticFallback: () => Promise<T>
): Promise<T> {
  try {
    const res = await apiCall();
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Request failed.');
      }
      return json as T;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError') &&
      !err.message.includes('Load failed')
    ) {
      throw err;
    }
  }
  return staticFallback();
}

export async function fetchStaticAdminOverview(yearId?: string | null) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const [
    { data: years },
    { data: players },
    { data: teams },
    { data: adminRoles },
    { data: auditLogs },
  ] = await Promise.all([
    supabase.from('awards_years').select('*').order('year_label', { ascending: false }),
    supabase.from('players').select('*').order('player_name', { ascending: true }),
    supabase.from('teams').select('*, members:team_members(*, player:players(*))').order('team_name', { ascending: true }),
    supabase.from('administrator_roles').select('*').order('created_at', { ascending: true }),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  const yearsList = (years || []) as AwardsYear[];
  const selectedYear =
    (yearId ? yearsList.find((y) => y.id === yearId) : null) ||
    yearsList.find((y) => y.is_active) ||
    yearsList[0] ||
    null;

  let categories: Category[] = [];
  let nominees: Nominee[] = [];
  let votesSummary: Array<{ category_id: string; nominee_id: string; count: number }> = [];
  let totalVotes = 0;
  let uniqueVoters = 0;
  let categoryResults: CategoryResult[] = [];
  let overallRankings: OverallRanking[] = [];

  if (selectedYear) {
    const [{ data: cats }, { data: noms }, { data: votes }, { data: catRes }, { data: rankings }] =
      await Promise.all([
        supabase
          .from('categories')
          .select('*, point_rules:category_point_rules(*)')
          .eq('awards_year_id', selectedYear.id)
          .order('display_order', { ascending: true }),
        supabase
          .from('nominees')
          .select('*, player:players(*), team:teams(*, members:team_members(*, player:players(*)))')
          .eq('awards_year_id', selectedYear.id)
          .order('display_name', { ascending: true }),
        supabase
          .from('votes')
          .select('category_id, nominee_id, voter_id')
          .eq('awards_year_id', selectedYear.id),
        supabase
          .from('category_results')
          .select('*, nominee:nominees(*)')
          .eq('awards_year_id', selectedYear.id)
          .order('position', { ascending: true }),
        supabase
          .from('overall_rankings')
          .select('*, player:players(*)')
          .eq('awards_year_id', selectedYear.id)
          .order('rank_position', { ascending: true }),
      ]);

    categories = ((cats || []) as Category[]).map((c) => ({
      ...c,
      point_rules: [...(c.point_rules || [])].sort((a, b) => a.position - b.position),
    }));
    nominees = (noms || []) as Nominee[];
    categoryResults = (catRes || []) as CategoryResult[];
    overallRankings = (rankings || []) as OverallRanking[];

    const voteList = votes || [];
    totalVotes = voteList.length;
    uniqueVoters = new Set(voteList.map((v) => v.voter_id)).size;

    const counts = new Map<string, number>();
    for (const v of voteList) {
      const k = `${v.category_id}::${v.nominee_id}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    votesSummary = Array.from(counts.entries()).map(([key, count]) => {
      const [category_id, nominee_id] = key.split('::');
      return { category_id, nominee_id, count };
    });
  }

  return {
    years: yearsList,
    selectedYear,
    categories,
    players: (players || []) as Player[],
    teams: (teams || []) as Team[],
    nominees,
    eligibilities: [],
    votesSummary,
    stats: {
      totalVotes,
      uniqueVoters,
      pendingEligibilities: 0,
      totalPlayers: (players || []).length,
      totalCategories: categories.length,
      totalNominees: nominees.length,
    },
    categoryResults,
    overallRankings,
    adminRoles: (adminRoles || []) as AdministratorRole[],
    auditLogs: (auditLogs || []) as AuditLog[],
  };
}

export async function uploadStaticStorageAsset(
  bucket: 'player-skins' | 'category-icons' | 'avatars',
  file: File
): Promise<{ url: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'image/png',
    upsert: false,
  });
  if (error) throw new Error(error.message || 'Storage upload failed.');
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return { url: data.publicUrl };
}

export async function saveStaticCategory(
  editingCatId: string | null,
  payload: {
    awards_year_id: string;
    name: string;
    description: string;
    icon_name: string;
    icon_url: string | null;
    display_order: number;
    winning_positions_count: number;
    is_enabled: boolean;
    is_team_category: boolean;
    point_rules: Array<{ position: number; points: number }>;
  }
) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const slug = slugify(payload.name);

  if (editingCatId) {
    const { data, error } = await supabase
      .from('categories')
      .update({
        name: payload.name,
        slug,
        description: payload.description,
        icon_name: payload.icon_name,
        icon_url: payload.icon_url,
        display_order: payload.display_order,
        winning_positions_count: payload.winning_positions_count,
        is_enabled: payload.is_enabled,
        is_team_category: payload.is_team_category,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingCatId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    await supabase.from('category_point_rules').delete().eq('category_id', editingCatId);
    if (payload.point_rules.length > 0) {
      await supabase.from('category_point_rules').insert(
        payload.point_rules.map((r) => ({ category_id: editingCatId, position: r.position, points: r.points }))
      );
    }
    return { category: data };
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      awards_year_id: payload.awards_year_id,
      name: payload.name,
      slug,
      description: payload.description,
      icon_name: payload.icon_name,
      icon_url: payload.icon_url,
      display_order: payload.display_order,
      winning_positions_count: payload.winning_positions_count,
      is_enabled: payload.is_enabled,
      is_team_category: payload.is_team_category,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  if (payload.point_rules.length > 0) {
    await supabase.from('category_point_rules').insert(
      payload.point_rules.map((r) => ({ category_id: data.id, position: r.position, points: r.points }))
    );
  }
  return { category: data };
}

export async function reorderStaticCategories(orderedIds: string[]) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  for (let i = 0; i < orderedIds.length; i += 1) {
    await supabase.from('categories').update({ display_order: i + 1 }).eq('id', orderedIds[i]);
  }
  return { ok: true };
}

export async function deleteStaticCategory(id: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function saveStaticPlayer(
  editingPlayerId: string | null,
  payload: {
    player_name: string;
    bio: string;
    avatar_url: string | null;
    skin_url: string | null;
    skin_model: SkinModel;
    social_links: Record<string, string | undefined>;
  }
) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const unique_slug = slugify(payload.player_name);

  if (editingPlayerId) {
    const { data, error } = await supabase
      .from('players')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', editingPlayerId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { player: data };
  }

  const { data, error } = await supabase
    .from('players')
    .insert({ ...payload, unique_slug })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { player: data };
}

export async function createStaticTeam(payload: {
  team_name: string;
  description: string;
  member_player_ids: string[];
}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: team, error } = await supabase
    .from('teams')
    .insert({
      team_name: payload.team_name,
      unique_slug: `${slugify(payload.team_name)}-${Date.now().toString(36)}`,
      description: payload.description,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  if (payload.member_player_ids.length > 0) {
    await supabase.from('team_members').insert(
      payload.member_player_ids.map((player_id) => ({ team_id: team.id, player_id }))
    );
  }
  return { team };
}

export async function addStaticNominee(payload: {
  awards_year_id: string;
  category_id: string;
  nominee_type: 'player' | 'team';
  player_id: string | null;
  team_id: string | null;
}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  let display_name = 'Nominee';
  let description = '';
  let profile_image_url: string | null = null;
  let skin_url: string | null = null;
  let skin_model: SkinModel = 'classic';
  let social_links = {};

  if (payload.nominee_type === 'player' && payload.player_id) {
    const { data: player } = await supabase.from('players').select('*').eq('id', payload.player_id).single();
    if (!player) throw new Error('Selected player not found.');
    display_name = player.player_name;
    description = player.bio || '';
    profile_image_url = player.avatar_url;
    skin_url = player.skin_url;
    skin_model = player.skin_model || 'classic';
    social_links = player.social_links || {};
  } else if (payload.nominee_type === 'team' && payload.team_id) {
    const { data: team } = await supabase.from('teams').select('*').eq('id', payload.team_id).single();
    if (!team) throw new Error('Selected team not found.');
    display_name = team.team_name;
    description = team.description || '';
    profile_image_url = team.avatar_url;
    social_links = team.social_links || {};
  }

  const { data, error } = await supabase
    .from('nominees')
    .insert({
      ...payload,
      display_name,
      description,
      profile_image_url,
      skin_url,
      skin_model,
      social_links,
      is_active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { nominee: data };
}

export async function deleteStaticNominee(id: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('nominees').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateStaticYear(yearId: string, patch: Partial<AwardsYear>) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('awards_years')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', yearId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { year: data };
}

export async function grantStaticAdminRole(email: string, role: 'super_admin' | 'awards_admin' | 'moderator') {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('administrator_roles')
    .upsert(
      { email: email.trim().toLowerCase(), role, is_active: true },
      { onConflict: 'email' }
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { role: data };
}

export async function calculateStaticResults(awardsYearId: string, publish = false) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: year, error: yearErr } = await supabase
    .from('awards_years')
    .select('*')
    .eq('id', awardsYearId)
    .single();
  if (yearErr || !year) throw new Error('Awards year not found.');

  const tiePolicy = year.tie_policy || 'shared_rank';
  const [{ data: categories }, { data: nominees }, { data: votes }, { data: teamMembers }] = await Promise.all([
    supabase
      .from('categories')
      .select('*, point_rules:category_point_rules(*)')
      .eq('awards_year_id', awardsYearId)
      .eq('is_enabled', true)
      .order('display_order', { ascending: true }),
    supabase.from('nominees').select('*').eq('awards_year_id', awardsYearId).eq('is_active', true),
    supabase.from('votes').select('category_id, nominee_id, created_at').eq('awards_year_id', awardsYearId),
    supabase.from('team_members').select('team_id, player_id'),
  ]);

  await supabase.from('category_results').delete().eq('awards_year_id', awardsYearId);
  await supabase.from('player_awards').delete().eq('awards_year_id', awardsYearId);
  await supabase.from('overall_rankings').delete().eq('awards_year_id', awardsYearId);

  const categoryResultsToInsert: Array<Record<string, unknown>> = [];
  const playerAwardsToInsert: Array<Record<string, unknown>> = [];

  for (const cat of (categories || []) as Category[]) {
    const catNominees = (nominees || []).filter((n) => n.category_id === cat.id);
    if (catNominees.length === 0) continue;
    const catVotes = (votes || []).filter((v) => v.category_id === cat.id);
    const totalCatVotes = catVotes.length;

    const map = new Map<string, { nomineeId: string; voteCount: number; earliestAt: string }>();
    for (const n of catNominees) {
      map.set(n.id, { nomineeId: n.id, voteCount: 0, earliestAt: '9999-12-31T23:59:59.999Z' });
    }
    for (const v of catVotes) {
      const e = map.get(v.nominee_id);
      if (!e) continue;
      e.voteCount += 1;
      if (e.voteCount === 1 || v.created_at > e.earliestAt) e.earliestAt = v.created_at;
    }

    const sorted = Array.from(map.values()).sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      if (tiePolicy === 'earliest_vote') return a.earliestAt.localeCompare(b.earliestAt);
      return a.nomineeId.localeCompare(b.nomineeId);
    });

    const rulesMap = new Map<number, number>();
    for (const r of cat.point_rules || []) rulesMap.set(Number(r.position), Number(r.points));

    let currentPosition = 1;
    const maxPositions = Number(cat.winning_positions_count || 3);

    for (let i = 0; i < sorted.length; i += 1) {
      const item = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      const next = i < sorted.length - 1 ? sorted[i + 1] : null;
      const tiedWithPrev = prev !== null && prev.voteCount === item.voteCount;
      const tiedWithNext = next !== null && next.voteCount === item.voteCount;
      const hasTie = item.voteCount > 0 && (tiedWithPrev || tiedWithNext);

      if (i > 0 && (tiePolicy === 'earliest_vote' || !tiedWithPrev)) {
        currentPosition = i + 1;
      }

      const qualifies = item.voteCount > 0 && currentPosition <= maxPositions;
      const pointsAwarded = qualifies ? (rulesMap.get(currentPosition) ?? 0) : 0;
      const pct = totalCatVotes > 0 ? Number(((item.voteCount / totalCatVotes) * 100).toFixed(2)) : 0;
      const pos = item.voteCount > 0 ? currentPosition : i + 1;

      categoryResultsToInsert.push({
        awards_year_id: awardsYearId,
        category_id: cat.id,
        nominee_id: item.nomineeId,
        position: pos,
        vote_count: item.voteCount,
        vote_percentage: pct,
        points_awarded: pointsAwarded,
        is_tie: hasTie,
        tiebreak_note: hasTie ? 'Shared placement' : null,
      });

      if (qualifies && pointsAwarded >= 0) {
        const nom = catNominees.find((n) => n.id === item.nomineeId);
        if (nom?.nominee_type === 'player' && nom.player_id) {
          playerAwardsToInsert.push({
            awards_year_id: awardsYearId,
            player_id: nom.player_id,
            category_id: cat.id,
            nominee_id: nom.id,
            source_type: 'individual',
            position: pos,
            points_earned: pointsAwarded,
          });
        } else if (nom?.nominee_type === 'team' && nom.team_id) {
          const members = (teamMembers || []).filter((m) => m.team_id === nom.team_id);
          for (const m of members) {
            playerAwardsToInsert.push({
              awards_year_id: awardsYearId,
              player_id: m.player_id,
              category_id: cat.id,
              nominee_id: nom.id,
              source_type: 'team_member',
              position: pos,
              points_earned: pointsAwarded,
            });
          }
        }
      }
    }
  }

  if (categoryResultsToInsert.length > 0) {
    const { error } = await supabase.from('category_results').insert(categoryResultsToInsert);
    if (error) throw new Error(error.message);
  }

  const dedupedAwards = Array.from(
    new Map(
      playerAwardsToInsert.map((r) => [
        `${r.awards_year_id}:${r.player_id}:${r.category_id}:${r.nominee_id}`,
        r,
      ])
    ).values()
  );

  if (dedupedAwards.length > 0) {
    const { error } = await supabase.from('player_awards').insert(dedupedAwards);
    if (error) throw new Error(error.message);
  }

  const totals = new Map<string, { playerId: string; totalPoints: number; categoriesWon: number; podiumFinishes: number }>();
  for (const pa of dedupedAwards) {
    const pid = String(pa.player_id);
    const pts = Number(pa.points_earned || 0);
    const pos = Number(pa.position || 99);
    const cur = totals.get(pid) || { playerId: pid, totalPoints: 0, categoriesWon: 0, podiumFinishes: 0 };
    cur.totalPoints += pts;
    if (pos === 1) cur.categoriesWon += 1;
    if (pos <= 3) cur.podiumFinishes += 1;
    totals.set(pid, cur);
  }

  const sortedPlayers = Array.from(totals.values()).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.categoriesWon !== a.categoriesWon) return b.categoriesWon - a.categoriesWon;
    if (b.podiumFinishes !== a.podiumFinishes) return b.podiumFinishes - a.podiumFinishes;
    return a.playerId.localeCompare(b.playerId);
  });

  const rankingsToInsert: Array<Record<string, unknown>> = [];
  let rank = 1;
  for (let i = 0; i < sortedPlayers.length; i += 1) {
    const p = sortedPlayers[i];
    if (i > 0 && (p.totalPoints !== sortedPlayers[i - 1].totalPoints || p.categoriesWon !== sortedPlayers[i - 1].categoriesWon)) {
      rank = i + 1;
    }
    rankingsToInsert.push({
      awards_year_id: awardsYearId,
      player_id: p.playerId,
      rank_position: rank,
      total_points: p.totalPoints,
      categories_won: p.categoriesWon,
      podium_finishes: p.podiumFinishes,
    });
  }

  if (rankingsToInsert.length > 0) {
    const { error } = await supabase.from('overall_rankings').insert(rankingsToInsert);
    if (error) throw new Error(error.message);
  }

  if (publish) {
    const { error } = await supabase
      .from('awards_years')
      .update({ status: 'results_published', updated_at: new Date().toISOString() })
      .eq('id', awardsYearId);
    if (error) throw new Error(error.message);
  }

  return {
    ok: true,
    categoriesProcessed: (categories || []).length,
    resultsCount: categoryResultsToInsert.length,
    rankedPlayersCount: rankingsToInsert.length,
  };
}
