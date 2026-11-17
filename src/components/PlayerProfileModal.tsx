import { X, Trophy, ExternalLink, Users } from 'lucide-react';
import { SkinViewer3D } from './SkinViewer3D';
import type { Category, Nominee, OverallRanking, PlayerAward } from '../types/awards';

interface PlayerProfileModalProps {
  open: boolean;
  onClose: () => void;
  nominee: Nominee | null;
  ranking?: OverallRanking | null;
  categories: Category[];
  resultsPublished: boolean;
  awards?: PlayerAward[];
}

export function PlayerProfileModal({
  open,
  onClose,
  nominee,
  ranking,
  categories,
  resultsPublished,
  awards = [],
}: PlayerProfileModalProps) {
  if (!open || (!nominee && !ranking)) return null;

  const displayName = nominee?.display_name || ranking?.player?.player_name || 'MultiCraft Player';
  const skinUrl = nominee?.skin_url || nominee?.player?.skin_url || ranking?.player?.skin_url || null;
  const skinModel = nominee?.skin_model || nominee?.player?.skin_model || ranking?.player?.skin_model || 'classic';
  const description = nominee?.description || nominee?.player?.bio || ranking?.player?.bio || '';
  const socialLinks = nominee?.social_links || nominee?.player?.social_links || ranking?.player?.social_links || {};
  const teamMembers = nominee?.team?.members || [];
  const profileAwards = awards.length > 0 ? awards : ranking?.awards || [];

  const totalPoints = ranking?.total_points ?? profileAwards.reduce((acc, a) => acc + (a.points_earned || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mc-backdrop)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} 3D profile`}
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--mc-border)] pb-4">
          <div>
            <p className="text-xs font-medium text-[var(--mc-accent)]">
              {nominee?.nominee_type === 'team' ? 'Duo / Team Profile' : 'Player Profile'}
              {resultsPublished && ranking ? ` · Rank #${ranking.rank_position}` : ''}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[var(--mc-ink)]">
              {displayName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-ink-muted)] transition-colors hover:text-[var(--mc-ink)]"
            aria-label="Close profile"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-6">
            <SkinViewer3D
              skinUrl={skinUrl}
              skinModel={skinModel}
              playerName={displayName}
              height={360}
            />
          </div>

          <div className="flex flex-col justify-between gap-5 md:col-span-6">
            <div className="space-y-4">
              {description && (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--mc-ink-muted)]">Biography</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--mc-ink)]">{description}</p>
                </div>
              )}

              {resultsPublished && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-4">
                  <div>
                    <span className="text-xs text-[var(--mc-ink-muted)]">Total Points</span>
                    <p className="mt-0.5 font-mono-tabular text-2xl font-semibold text-[var(--mc-accent)]">
                      {totalPoints}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--mc-ink-muted)]">Placements</span>
                    <p className="mt-0.5 font-mono-tabular text-2xl font-semibold text-[var(--mc-ink)]">
                      {profileAwards.length}
                    </p>
                  </div>
                </div>
              )}

              {resultsPublished && profileAwards.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--mc-ink-muted)]">
                    Official Achievements
                  </h3>
                  <ul className="divide-y divide-[var(--mc-border)] rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)]">
                    {profileAwards.map((award) => {
                      const catName =
                        award.category?.name ||
                        categories.find((c) => c.id === award.category_id)?.name ||
                        'Award Category';
                      return (
                        <li key={award.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[var(--mc-ink)]">{catName}</p>
                            <p className="text-xs text-[var(--mc-ink-muted)]">
                              Position #{award.position}
                              {award.source_type === 'team_member' ? ' · Team Award' : ''}
                            </p>
                          </div>
                          <span className="font-mono-tabular inline-flex items-center gap-1 text-xs font-semibold text-[var(--mc-accent)] shrink-0">
                            <Trophy className="h-3.5 w-3.5" />
                            +{award.points_earned} pts
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {teamMembers.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--mc-ink-muted)]">
                    <Users className="h-3.5 w-3.5" />
                    Registered Team Members
                  </h3>
                  <div className="space-y-2 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-3">
                    {teamMembers.map((member) => (
                      <div key={member.id} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[var(--mc-ink)]">
                          {member.player?.player_name || 'Team Member'}
                        </span>
                        <span className="text-xs text-[var(--mc-ink-muted)]">{member.role_label || 'Member'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {Object.entries(socialLinks).some(([, url]) => Boolean(url)) && (
              <div className="border-t border-[var(--mc-border)] pt-4">
                <h3 className="mb-2 text-xs font-semibold text-[var(--mc-ink-muted)]">Community Links</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(socialLinks).map(([platform, url]) =>
                    url ? (
                      <a
                        key={platform}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] px-3 text-xs font-medium capitalize text-[var(--mc-ink)] transition-colors hover:border-[var(--mc-accent-border)] hover:text-[var(--mc-accent)]"
                      >
                        {platform}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
