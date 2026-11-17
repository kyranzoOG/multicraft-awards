import type { SupabaseClient } from '@supabase/supabase-js';
import type { TiePolicy } from '../src/types/awards.ts';

interface VoteAggregate {
  nomineeId: string;
  voteCount: number;
  earliestCompletionAt: string;
}

export async function calculateAwardsYearResults(
  adminClient: SupabaseClient,
  awardsYearId: string
): Promise<{
  categoriesProcessed: number;
  resultsCount: number;
  rankedPlayersCount: number;
}> {
  const { data: year, error: yearErr } = await adminClient
    .from('awards_years')
    .select('*')
    .eq('id', awardsYearId)
    .single();

  if (yearErr || !year) {
    throw new Error('Awards year not found.');
  }

  const tiePolicy = (year.tie_policy || 'shared_rank') as TiePolicy;

  const [{ data: categories }, { data: nominees }, { data: votes }, { data: teamMembers }] =
    await Promise.all([
      adminClient
        .from('categories')
        .select('*, point_rules:category_point_rules(*)')
        .eq('awards_year_id', awardsYearId)
        .eq('is_enabled', true)
        .order('display_order', { ascending: true }),
      adminClient
        .from('nominees')
        .select('*')
        .eq('awards_year_id', awardsYearId)
        .eq('is_active', true),
      adminClient
        .from('votes')
        .select('category_id, nominee_id, created_at')
        .eq('awards_year_id', awardsYearId),
      adminClient.from('team_members').select('team_id, player_id'),
    ]);

  const categoryList = categories || [];
  const nomineeList = nominees || [];
  const voteList = votes || [];
  const teamMemberList = teamMembers || [];

  // Clear previous calculated rows for this awards year cleanly so recalculation never duplicates points
  await adminClient.from('category_results').delete().eq('awards_year_id', awardsYearId);
  await adminClient.from('player_awards').delete().eq('awards_year_id', awardsYearId);
  await adminClient.from('overall_rankings').delete().eq('awards_year_id', awardsYearId);

  const categoryResultsToInsert: Array<Record<string, unknown>> = [];
  const playerAwardsToInsert: Array<Record<string, unknown>> = [];

  for (const category of categoryList) {
    const catNominees = nomineeList.filter((n) => n.category_id === category.id);
    if (catNominees.length === 0) continue;

    const catVotes = voteList.filter((v) => v.category_id === category.id);
    const totalCatVotes = catVotes.length;

    const aggregateMap = new Map<string, VoteAggregate>();
    for (const nom of catNominees) {
      aggregateMap.set(nom.id, {
        nomineeId: nom.id,
        voteCount: 0,
        earliestCompletionAt: '9999-12-31T23:59:59.999Z',
      });
    }

    for (const vote of catVotes) {
      const entry = aggregateMap.get(vote.nominee_id);
      if (!entry) continue;
      entry.voteCount += 1;
      // Track latest timestamp of reaching this count (for earliest_vote tiebreak)
      if (entry.voteCount === 1 || vote.created_at > entry.earliestCompletionAt) {
        entry.earliestCompletionAt = vote.created_at;
      }
    }

    const sorted = Array.from(aggregateMap.values()).sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      if (tiePolicy === 'earliest_vote') {
        return a.earliestCompletionAt.localeCompare(b.earliestCompletionAt);
      }
      return a.nomineeId.localeCompare(b.nomineeId);
    });

    const rulesMap = new Map<number, number>();
    for (const rule of category.point_rules || []) {
      rulesMap.set(Number(rule.position), Number(rule.points));
    }

    const maxPositions = Number(category.winning_positions_count || 3);
    let currentPosition = 1;

    for (let i = 0; i < sorted.length; i += 1) {
      const item = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      const next = i < sorted.length - 1 ? sorted[i + 1] : null;

      const tiedWithPrev = prev !== null && prev.voteCount === item.voteCount;
      const tiedWithNext = next !== null && next.voteCount === item.voteCount;
      const hasTie = item.voteCount > 0 && (tiedWithPrev || tiedWithNext);

      if (i > 0) {
        if (tiePolicy === 'earliest_vote') {
          currentPosition = i + 1;
        } else {
          // shared_rank or admin_tiebreak: identical vote counts share position
          if (!tiedWithPrev) {
            currentPosition = i + 1;
          }
        }
      }

      const qualifiesForPosition = item.voteCount > 0 && currentPosition <= maxPositions;
      const pointsAwarded = qualifiesForPosition ? (rulesMap.get(currentPosition) ?? 0) : 0;
      const votePercentage =
        totalCatVotes > 0 ? Number(((item.voteCount / totalCatVotes) * 100).toFixed(2)) : 0;

      const positionToStore = item.voteCount > 0 ? currentPosition : i + 1;

      categoryResultsToInsert.push({
        awards_year_id: awardsYearId,
        category_id: category.id,
        nominee_id: item.nomineeId,
        position: positionToStore,
        vote_count: item.voteCount,
        vote_percentage: votePercentage,
        points_awarded: pointsAwarded,
        is_tie: hasTie,
        tiebreak_note:
          hasTie && tiePolicy === 'earliest_vote'
            ? 'Resolved by earliest vote milestone'
            : hasTie && tiePolicy === 'admin_tiebreak'
              ? 'Pending admin tiebreak review'
              : hasTie
                ? 'Shared placement'
                : null,
      });

      if (qualifiesForPosition && pointsAwarded >= 0) {
        const nomineeObj = catNominees.find((n) => n.id === item.nomineeId);
        if (nomineeObj?.nominee_type === 'player' && nomineeObj.player_id) {
          playerAwardsToInsert.push({
            awards_year_id: awardsYearId,
            player_id: nomineeObj.player_id,
            category_id: category.id,
            nominee_id: nomineeObj.id,
            source_type: 'individual',
            position: positionToStore,
            points_earned: pointsAwarded,
          });
        } else if (nomineeObj?.nominee_type === 'team' && nomineeObj.team_id) {
          const members = teamMemberList.filter((m) => m.team_id === nomineeObj.team_id);
          for (const member of members) {
            // Every registered member receives the FULL points awarded to the team
            playerAwardsToInsert.push({
              awards_year_id: awardsYearId,
              player_id: member.player_id,
              category_id: category.id,
              nominee_id: nomineeObj.id,
              source_type: 'team_member',
              position: positionToStore,
              points_earned: pointsAwarded,
            });
          }
        }
      }
    }
  }

  if (categoryResultsToInsert.length > 0) {
    const { error: resErr } = await adminClient
      .from('category_results')
      .insert(categoryResultsToInsert);
    if (resErr) throw resErr;
  }

  if (playerAwardsToInsert.length > 0) {
    // Deduplicate safety by unique composite key
    const deduped = new Map<string, Record<string, unknown>>();
    for (const row of playerAwardsToInsert) {
      const key = `${row.awards_year_id}:${row.player_id}:${row.category_id}:${row.nominee_id}`;
      if (!deduped.has(key)) {
        deduped.set(key, row);
      }
    }
    const { error: paErr } = await adminClient
      .from('player_awards')
      .insert(Array.from(deduped.values()));
    if (paErr) throw paErr;
  }

  // Aggregate overall player leaderboard
  const playerTotals = new Map<
    string,
    { playerId: string; totalPoints: number; categoriesWon: number; podiumFinishes: number }
  >();

  for (const pa of playerAwardsToInsert) {
    const playerId = String(pa.player_id);
    const points = Number(pa.points_earned || 0);
    const pos = Number(pa.position || 99);
    const existing = playerTotals.get(playerId) || {
      playerId,
      totalPoints: 0,
      categoriesWon: 0,
      podiumFinishes: 0,
    };
    existing.totalPoints += points;
    if (pos === 1) existing.categoriesWon += 1;
    if (pos <= 3) existing.podiumFinishes += 1;
    playerTotals.set(playerId, existing);
  }

  const sortedPlayers = Array.from(playerTotals.values()).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.categoriesWon !== a.categoriesWon) return b.categoriesWon - a.categoriesWon;
    if (b.podiumFinishes !== a.podiumFinishes) return b.podiumFinishes - a.podiumFinishes;
    return a.playerId.localeCompare(b.playerId);
  });

  const overallRankingsToInsert: Array<Record<string, unknown>> = [];
  let rank = 1;
  for (let i = 0; i < sortedPlayers.length; i += 1) {
    const p = sortedPlayers[i];
    if (i > 0) {
      const prev = sortedPlayers[i - 1];
      if (p.totalPoints !== prev.totalPoints || p.categoriesWon !== prev.categoriesWon) {
        rank = i + 1;
      }
    }
    overallRankingsToInsert.push({
      awards_year_id: awardsYearId,
      player_id: p.playerId,
      rank_position: rank,
      total_points: p.totalPoints,
      categories_won: p.categoriesWon,
      podium_finishes: p.podiumFinishes,
    });
  }

  if (overallRankingsToInsert.length > 0) {
    const { error: rankErr } = await adminClient
      .from('overall_rankings')
      .insert(overallRankingsToInsert);
    if (rankErr) throw rankErr;
  }

  return {
    categoriesProcessed: categoryList.length,
    resultsCount: categoryResultsToInsert.length,
    rankedPlayersCount: overallRankingsToInsert.length,
  };
}
