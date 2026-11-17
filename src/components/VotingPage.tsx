import { useMemo, useState } from 'react';
import { AlertCircle, Box, CheckCircle2, Lock, ShieldCheck, Users } from 'lucide-react';
import { CategoryIcon } from '../lib/icons';
import { SkinCharacterPreview } from './SkinCharacterPreview';
import type { AwardsYear, Category, Nominee, VoterSessionState } from '../types/awards';

interface VotingPageProps {
  selectedYear: AwardsYear | null;
  categories: Category[];
  nominees: Nominee[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string) => void;
  voterSession: VoterSessionState;
  onOpenAuthModal: () => void;
  onInspectNominee: (nominee: Nominee) => void;
  onCastVote: (categoryId: string, nomineeId: string) => Promise<void>;
}

export function VotingPage({
  selectedYear,
  categories,
  nominees,
  selectedCategoryId,
  onSelectCategory,
  voterSession,
  onOpenAuthModal,
  onInspectNominee,
  onCastVote,
}: VotingPageProps) {
  const [votingId, setVotingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

  const activeCategory = useMemo(() => {
    if (categories.length === 0) return null;
    return categories.find((c) => c.id === selectedCategoryId) || categories[0];
  }, [categories, selectedCategoryId]);

  const activeNominees = useMemo(() => {
    if (!activeCategory) return [];
    return nominees.filter((n) => n.category_id === activeCategory.id);
  }, [nominees, activeCategory]);

  const votesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of voterSession.votes) {
      map.set(v.category_id, v.nominee_id);
    }
    return map;
  }, [voterSession.votes]);

  const votingOpen = selectedYear?.status === 'voting_active';

  const handleVote = async (categoryId: string, nomineeId: string) => {
    setFeedback(null);
    if (!voterSession.voter || !voterSession.emailVerified || !voterSession.overallEligible) {
      onOpenAuthModal();
      return;
    }
    setVotingId(nomineeId);
    try {
      await onCastVote(categoryId, nomineeId);
      setFeedback({ type: 'ok', message: 'Your vote has been securely recorded.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        message: err instanceof Error ? err.message : 'Unable to record vote.',
      });
    } finally {
      setVotingId(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--mc-border)] pb-5">
        <div>
          <p className="text-xs font-semibold text-[var(--mc-accent)]">
            {selectedYear ? selectedYear.title : 'Community Ballot'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--mc-ink)]">
            Community Voting
          </h1>
        </div>

        <button
          type="button"
          onClick={onOpenAuthModal}
          className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-xs font-semibold ${
            voterSession.overallEligible
              ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] text-[var(--mc-accent)]'
              : 'border-[var(--mc-border-strong)] bg-[var(--mc-surface)] text-[var(--mc-ink)]'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          {voterSession.voter
            ? voterSession.emailVerified
              ? `Verified · ${voterSession.votes.length}/${categories.length} Voted`
              : 'Verify Email to Vote'
            : 'Sign In to Vote'}
        </button>
      </div>

      {!votingOpen && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4 text-sm text-[var(--mc-ink-muted)]">
          <Lock className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
          <span>Voting is currently closed for this edition.</span>
        </div>
      )}

      {feedback && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] px-4 py-3 text-xs font-medium text-[var(--mc-ink)]">
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-4">
          {categories.map((cat) => {
            const isSelected = activeCategory?.id === cat.id;
            const voted = votesMap.has(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  onSelectCategory(cat.id);
                  setFeedback(null);
                }}
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
                  <span className="truncate font-display text-sm font-semibold text-[var(--mc-ink)]">
                    {cat.name}
                  </span>
                </div>
                {voted && <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />}
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-8">
          {activeCategory && (
            <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
              <div className="border-b border-[var(--mc-border)] pb-4">
                <h2 className="font-display text-2xl font-bold text-[var(--mc-ink)]">{activeCategory.name}</h2>
                {activeCategory.description && (
                  <p className="mt-1 text-sm text-[var(--mc-ink-muted)]">{activeCategory.description}</p>
                )}
              </div>

              {activeNominees.length === 0 ? (
                <p className="py-12 text-center text-sm text-[var(--mc-ink-muted)]">
                  No nominees added to this category yet.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {activeNominees.map((nom) => {
                    const votedHere = votesMap.get(activeCategory.id) === nom.id;
                    const hasVotedInCat = votesMap.has(activeCategory.id);
                    const disabled =
                      !votingOpen ||
                      votingId === nom.id ||
                      (hasVotedInCat && !selectedYear?.allow_vote_editing && !votedHere);

                    return (
                      <div
                        key={nom.id}
                        className={`flex flex-col justify-between gap-4 rounded-xl border p-4 ${
                          votedHere
                            ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)]'
                            : 'border-[var(--mc-border)] bg-[var(--mc-surface-elevated)]'
                        }`}
                      >
                        <div>
                          <SkinCharacterPreview
                            skinUrl={nom.skin_url || nom.player?.skin_url || null}
                            skinModel={nom.skin_model || nom.player?.skin_model || 'classic'}
                            name={nom.display_name}
                          />
                          <p className="mt-3 font-display text-base font-semibold text-[var(--mc-ink)]">
                            {nom.display_name}
                          </p>
                          {nom.nominee_type === 'team' && nom.team?.members && nom.team.members.length > 0 && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-[var(--mc-ink-muted)]">
                              <Users className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {nom.team.members.map((m) => m.player?.player_name).filter(Boolean).join(', ')}
                              </span>
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onInspectNominee(nom)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] text-xs font-medium text-[var(--mc-ink)]"
                          >
                            <Box className="h-3.5 w-3.5 text-[var(--mc-accent)]" />
                            3D View
                          </button>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => handleVote(activeCategory.id, nom.id)}
                            className={`inline-flex h-9 flex-1 items-center justify-center rounded-lg text-xs font-semibold ${
                              votedHere
                                ? 'bg-[var(--mc-accent)] text-[var(--mc-accent-contrast)]'
                                : 'bg-[var(--mc-ink)] text-[var(--mc-bg)] hover:bg-[var(--mc-accent)] hover:text-[var(--mc-accent-contrast)] disabled:opacity-40'
                            }`}
                          >
                            {votedHere ? 'Voted' : votingId === nom.id ? 'Voting...' : 'Vote'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
