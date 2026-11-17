import { CategoryIcon } from '../lib/icons';
import { SkinCharacterPreview } from './SkinCharacterPreview';
import type { AwardsYear, Category, CategoryResult, Nominee } from '../types/awards';

interface MainHomePageProps {
  selectedYear: AwardsYear | null;
  categories: Category[];
  nominees: Nominee[];
  resultsPublished: boolean;
  categoryResults: CategoryResult[] | null;
  loading: boolean;
  onGoToCategory: (categoryId: string) => void;
  onInspectNominee: (nominee: Nominee) => void;
}

export function MainHomePage({
  selectedYear,
  categories,
  nominees,
  resultsPublished,
  categoryResults,
  loading,
  onGoToCategory,
  onInspectNominee,
}: MainHomePageProps) {
  if (loading) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-56 animate-pulse rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)]"
            />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--mc-border)] pb-5">
        <div>
          <p className="text-xs font-semibold text-[var(--mc-accent)]">
            {selectedYear ? `${selectedYear.year_label} Edition` : 'MultiCraft Awards'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--mc-ink)]">
            Award Categories
          </h1>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-12 text-center">
          <p className="font-display text-lg font-semibold text-[var(--mc-ink)]">No Categories Available</p>
          <p className="mt-1 text-sm text-[var(--mc-ink-muted)]">
            Categories for this edition will appear here once configured.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {categories.map((cat) => {
            const count = Math.max(1, cat.winning_positions_count || 3);
            const positions = Array.from({ length: count }, (_, idx) => idx + 1);
            const catResults = resultsPublished
              ? (categoryResults || []).filter((r) => r.category_id === cat.id)
              : [];
            const catNominees = nominees.filter((n) => n.category_id === cat.id);

            return (
              <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] text-[var(--mc-accent)]">
                      <CategoryIcon iconName={cat.icon_name} iconUrl={cat.icon_url} className="h-4 w-4" />
                    </span>
                    <div>
                      <h2
                        id={`cat-${cat.id}`}
                        className="font-display text-xl font-bold tracking-tight text-[var(--mc-ink)]"
                      >
                        {cat.name}
                      </h2>
                      <p className="text-xs text-[var(--mc-ink-muted)]">Top {count}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => onGoToCategory(cat.id)}
                      className="text-[var(--mc-ink-muted)] transition-colors hover:text-[var(--mc-ink)] whitespace-nowrap"
                    >
                      View Nominees ({catNominees.length})
                    </button>
                  </div>
                </div>

                <div
                  className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
                    count === 3 ? 'lg:grid-cols-3' : count >= 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-3'
                  }`}
                >
                  {positions.map((pos) => {
                    const winnerResult = resultsPublished
                      ? catResults.find((r) => r.position === pos && r.vote_count > 0)
                      : undefined;
                    const winnerNominee = winnerResult?.nominee || null;

                    return (
                      <button
                        key={pos}
                        type="button"
                        disabled={!winnerNominee}
                        onClick={() => winnerNominee && onInspectNominee(winnerNominee)}
                        className={`flex flex-col items-center gap-3 rounded-2xl border p-4 text-center transition-colors ${
                          winnerNominee
                            ? 'cursor-pointer border-[var(--mc-border-strong)] bg-[var(--mc-surface)] hover:border-[var(--mc-accent-border)]'
                            : 'cursor-default border-[var(--mc-border)] bg-[var(--mc-surface)]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between text-xs">
                          <span className="font-mono-tabular font-bold text-[var(--mc-accent)]">
                            Top {pos}
                          </span>
                          {winnerResult && (
                            <span className="font-mono-tabular text-[var(--mc-ink-muted)]">
                              {winnerResult.points_awarded} pts
                            </span>
                          )}
                        </div>

                        <SkinCharacterPreview
                          skinUrl={winnerNominee?.skin_url || winnerNominee?.player?.skin_url || null}
                          skinModel={winnerNominee?.skin_model || winnerNominee?.player?.skin_model || 'classic'}
                          name={winnerNominee?.display_name || `Top ${pos}`}
                          sealed={!resultsPublished}
                        />

                        <div className="w-full min-w-0">
                          <p className="truncate font-display text-sm font-semibold text-[var(--mc-ink)]">
                            {resultsPublished
                              ? winnerNominee?.display_name || 'Unclaimed'
                              : 'Results Sealed'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
