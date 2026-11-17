import { useMemo } from 'react';
import { Lock, Trophy } from 'lucide-react';
import { CategoryIcon } from '../lib/icons';
import { SkinCharacterPreview } from './SkinCharacterPreview';
import type {
  AwardsYear,
  Category,
  CategoryResult,
  Nominee,
  OverallRanking,
} from '../types/awards';

interface WinnersPageProps {
  years: AwardsYear[];
  selectedYear: AwardsYear | null;
  onSelectYear: (yearId: string) => void;
  categories: Category[];
  resultsPublished: boolean;
  categoryResults: CategoryResult[] | null;
  overallRankings: OverallRanking[] | null;
  onInspectProfile: (nominee: Nominee | null, ranking?: OverallRanking | null) => void;
}

export function WinnersPage({
  years,
  selectedYear,
  onSelectYear,
  categories,
  resultsPublished,
  categoryResults,
  overallRankings,
  onInspectProfile,
}: WinnersPageProps) {
  const resultsByCategory = useMemo(() => {
    const map = new Map<string, CategoryResult[]>();
    if (!resultsPublished || !categoryResults) return map;
    for (const r of categoryResults) {
      const list = map.get(r.category_id) || [];
      list.push(r);
      map.set(r.category_id, list);
    }
    for (const [k, list] of map.entries()) {
      map.set(
        k,
        list.sort((a, b) => a.position - b.position)
      );
    }
    return map;
  }, [resultsPublished, categoryResults]);

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--mc-border)] pb-5">
        <div>
          <p className="text-xs font-semibold text-[var(--mc-accent)]">Official Results & Past Winners</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--mc-ink)]">
            {selectedYear ? `${selectedYear.title} Winners` : 'Winners & Leaderboard'}
          </h1>
        </div>

        {years.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {years.map((y) => (
              <button
                key={y.id}
                type="button"
                onClick={() => onSelectYear(y.id)}
                className={`h-9 rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
                  selectedYear?.id === y.id
                    ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent)] text-[var(--mc-accent-contrast)]'
                    : 'border-[var(--mc-border-strong)] bg-[var(--mc-surface)] text-[var(--mc-ink)] hover:border-[var(--mc-accent-border)]'
                }`}
              >
                {y.year_label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!resultsPublished ? (
        <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-12 text-center">
          <Lock className="mx-auto h-8 w-8 text-[var(--mc-accent)]" />
          <h2 className="mt-3 font-display text-xl font-semibold text-[var(--mc-ink)]">
            Results Are Currently Sealed
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--mc-ink-muted)]">
            Winners, vote counts, and the Overall Player leaderboard for this year will appear here as soon as an
            administrator publishes the official results.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {/* Overall Player Leaderboard */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-[var(--mc-ink)]">
              Overall MultiCraft Player of the Year
            </h2>
            {!overallRankings || overallRankings.length === 0 ? (
              <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 text-sm text-[var(--mc-ink-muted)]">
                No overall player rankings recorded for this edition.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)]">
                <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--mc-border)] text-xs text-[var(--mc-ink-muted)]">
                      <th className="px-5 py-3.5 font-medium">Rank</th>
                      <th className="px-5 py-3.5 font-medium">Player</th>
                      <th className="px-5 py-3.5 font-medium">Awards</th>
                      <th className="px-5 py-3.5 text-right font-medium">Wins</th>
                      <th className="px-5 py-3.5 text-right font-medium">Total Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--mc-border)]">
                    {overallRankings.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onInspectProfile(null, row)}
                        className="cursor-pointer transition-colors hover:bg-[var(--mc-surface-elevated)]"
                      >
                        <td className="px-5 py-4 font-mono-tabular font-bold text-[var(--mc-accent)]">
                          #{row.rank_position}
                        </td>
                        <td className="px-5 py-4 font-semibold text-[var(--mc-ink)]">
                          {row.player?.player_name || 'Player'}
                        </td>
                        <td className="px-5 py-4 text-xs text-[var(--mc-ink-muted)]">
                          {(row.awards || [])
                            .map((a) => `${a.category?.name || 'Award'} (#${a.position})`)
                            .join(' · ') || '—'}
                        </td>
                        <td className="px-5 py-4 text-right font-mono-tabular text-[var(--mc-ink)]">
                          {row.categories_won}
                        </td>
                        <td className="px-5 py-4 text-right font-mono-tabular font-bold text-[var(--mc-accent)]">
                          {row.total_points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Category Winners */}
          <section className="space-y-8">
            <h2 className="font-display text-2xl font-bold text-[var(--mc-ink)]">Category Winners</h2>
            {categories.map((cat) => {
              const catRes = (resultsByCategory.get(cat.id) || []).filter(
                (r) => r.position <= cat.winning_positions_count && r.vote_count > 0
              );
              return (
                <div key={cat.id} className="space-y-4">
                  <div className="flex items-center gap-2.5">
                    <CategoryIcon iconName={cat.icon_name} iconUrl={cat.icon_url} className="h-5 w-5 text-[var(--mc-accent)]" />
                    <h3 className="font-display text-xl font-bold text-[var(--mc-ink)]">{cat.name}</h3>
                  </div>

                  {catRes.length === 0 ? (
                    <p className="text-sm text-[var(--mc-ink-muted)]">No winners recorded.</p>
                  ) : (
                    <div
                      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
                        cat.winning_positions_count >= 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-3'
                      }`}
                    >
                      {catRes.map((res) => (
                        <button
                          key={res.id}
                          type="button"
                          onClick={() => res.nominee && onInspectProfile(res.nominee, null)}
                          className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] p-4 text-center transition-colors hover:border-[var(--mc-accent-border)]"
                        >
                          <div className="flex w-full items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1 font-mono-tabular font-bold text-[var(--mc-accent)]">
                              <Trophy className="h-3.5 w-3.5" />
                              Top {res.position}
                            </span>
                            <span className="font-mono-tabular text-[var(--mc-ink-muted)]">
                              +{res.points_awarded} pts
                            </span>
                          </div>
                          <SkinCharacterPreview
                            skinUrl={res.nominee?.skin_url || res.nominee?.player?.skin_url || null}
                            skinModel={res.nominee?.skin_model || res.nominee?.player?.skin_model || 'classic'}
                            name={res.nominee?.display_name || 'Winner'}
                          />
                          <div className="w-full min-w-0">
                            <p className="truncate font-display text-sm font-semibold text-[var(--mc-ink)]">
                              {res.nominee?.display_name}
                            </p>
                            <p className="font-mono-tabular text-xs text-[var(--mc-ink-muted)]">
                              {res.vote_count} votes ({res.vote_percentage}%)
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </main>
  );
}
