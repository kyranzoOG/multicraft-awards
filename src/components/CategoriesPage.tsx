import { useMemo } from 'react';
import { Box, Users, ChevronRight } from 'lucide-react';
import { CategoryIcon } from '../lib/icons';
import { SkinCharacterPreview } from './SkinCharacterPreview';
import type { AwardsYear, Category, Nominee } from '../types/awards';

interface CategoriesPageProps {
  selectedYear: AwardsYear | null;
  categories: Category[];
  nominees: Nominee[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string) => void;
  onInspectNominee: (nominee: Nominee) => void;
}

export function CategoriesPage({
  selectedYear,
  categories,
  nominees,
  selectedCategoryId,
  onSelectCategory,
  onInspectNominee,
}: CategoriesPageProps) {
  const activeCategory = useMemo(() => {
    if (categories.length === 0) return null;
    return categories.find((c) => c.id === selectedCategoryId) || categories[0];
  }, [categories, selectedCategoryId]);

  const catNominees = useMemo(() => {
    if (!activeCategory) return [];
    return nominees.filter((n) => n.category_id === activeCategory.id);
  }, [nominees, activeCategory]);

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 border-b border-[var(--mc-border)] pb-5">
        <p className="text-xs font-semibold text-[var(--mc-accent)]">
          {selectedYear ? selectedYear.title : 'Categories Directory'}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--mc-ink)]">
          Categories & Nominees
        </h1>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-10 text-center text-sm text-[var(--mc-ink-muted)]">
          No categories available for this awards year.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Category Rail */}
          <div className="space-y-2 lg:col-span-4">
            {categories.map((cat) => {
              const isSelected = activeCategory?.id === cat.id;
              const count = nominees.filter((n) => n.category_id === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectCategory(cat.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)]'
                      : 'border-[var(--mc-border)] bg-[var(--mc-surface)] hover:bg-[var(--mc-surface-elevated)]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-accent)]">
                      <CategoryIcon iconName={cat.icon_name} iconUrl={cat.icon_url} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-semibold text-[var(--mc-ink)]">
                        {cat.name}
                      </p>
                      <p className="text-xs text-[var(--mc-ink-muted)]">
                        Top {cat.winning_positions_count} · {count} nominees
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mc-ink-muted)]" />
                </button>
              );
            })}
          </div>

          {/* Dedicated Category Space */}
          <div className="lg:col-span-8">
            {activeCategory && (
              <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--mc-border)] pb-5">
                  <div>
                    <p className="text-xs font-medium text-[var(--mc-accent)]">
                      Top {activeCategory.winning_positions_count} Positions
                      {activeCategory.is_team_category ? ' · Duo / Team Category' : ''}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-bold text-[var(--mc-ink)]">
                      {activeCategory.name}
                    </h2>
                    {activeCategory.description && (
                      <p className="mt-2 text-sm leading-relaxed text-[var(--mc-ink-muted)]">
                        {activeCategory.description}
                      </p>
                    )}
                  </div>
                </div>

                {activeCategory.point_rules && activeCategory.point_rules.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-semibold text-[var(--mc-ink-muted)]">
                      Position Point Rules
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {activeCategory.point_rules.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] px-3 py-1.5 font-mono-tabular text-xs text-[var(--mc-ink)]"
                        >
                          #{r.position}: <span className="font-semibold text-[var(--mc-accent)]">{r.points} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="mb-3 text-xs font-semibold text-[var(--mc-ink-muted)]">
                    Nominees ({catNominees.length})
                  </h3>

                  {catNominees.length === 0 ? (
                    <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-10 text-center text-sm text-[var(--mc-ink-muted)]">
                      No nominees have been assigned to {activeCategory.name} yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {catNominees.map((nom) => (
                        <button
                          key={nom.id}
                          type="button"
                          onClick={() => onInspectNominee(nom)}
                          className="flex flex-col gap-3 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-4 text-left transition-colors hover:border-[var(--mc-accent-border)]"
                        >
                          <SkinCharacterPreview
                            skinUrl={nom.skin_url || nom.player?.skin_url || null}
                            skinModel={nom.skin_model || nom.player?.skin_model || 'classic'}
                            name={nom.display_name}
                          />
                          <div>
                            <p className="font-display text-base font-semibold text-[var(--mc-ink)]">
                              {nom.display_name}
                            </p>
                            {nom.description && (
                              <p className="mt-1 line-clamp-2 text-xs text-[var(--mc-ink-muted)]">
                                {nom.description}
                              </p>
                            )}
                            {nom.nominee_type === 'team' && nom.team?.members && nom.team.members.length > 0 && (
                              <p className="mt-2 flex items-center gap-1 text-xs text-[var(--mc-ink-muted)]">
                                <Users className="h-3.5 w-3.5" />
                                <span className="truncate">
                                  {nom.team.members.map((m) => m.player?.player_name).filter(Boolean).join(', ')}
                                </span>
                              </p>
                            )}
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--mc-accent)]">
                            <Box className="h-3.5 w-3.5" />
                            Inspect 3D Character
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
