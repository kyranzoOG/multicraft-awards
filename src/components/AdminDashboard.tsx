import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  FolderKanban,
  Users,
  UserPlus,
  Trophy,
  History,
  Trash2,
  ArrowUp,
  ArrowDown,
  Upload,
  CheckCircle2,
  AlertCircle,
  Lock,
  Plus,
  Sun,
  Moon,
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import {
  addStaticNominee,
  apiOrStaticFallback,
  calculateStaticResults,
  createStaticTeam,
  deleteStaticCategory,
  deleteStaticNominee,
  fetchStaticAdminOverview,
  grantStaticAdminRole,
  reorderStaticCategories,
  saveStaticCategory,
  saveStaticPlayer,
  updateStaticYear,
  uploadStaticStorageAsset,
} from '../lib/staticAdmin';
import { CATEGORY_ICON_OPTIONS, CategoryIcon } from '../lib/icons';
import { SkinViewer3D } from './SkinViewer3D';
import type {
  AdministratorRole,
  AuditLog,
  AwardsYear,
  AwardsYearStatus,
  Category,
  CategoryResult,
  EligibilityRecord,
  Nominee,
  OverallRanking,
  Player,
  SkinModel,
  Team,
  TiePolicy,
  VoterIdentity,
  VoterSessionState,
} from '../types/awards';

type AdminTab =
  | 'overview'
  | 'categories'
  | 'players'
  | 'nominees'
  | 'results'
  | 'security';

interface AdminOverviewData {
  years: AwardsYear[];
  selectedYear: AwardsYear | null;
  categories: Category[];
  players: Player[];
  teams: Team[];
  nominees: Nominee[];
  eligibilities: Array<EligibilityRecord & { voter?: VoterIdentity }>;
  votesSummary: Array<{ category_id: string; nominee_id: string; count: number }>;
  stats: {
    totalVotes: number;
    uniqueVoters: number;
    pendingEligibilities: number;
    totalPlayers: number;
    totalCategories: number;
    totalNominees: number;
  };
  categoryResults: CategoryResult[];
  overallRankings: OverallRanking[];
  adminRoles: AdministratorRole[];
  auditLogs: AuditLog[];
}

interface AdminDashboardProps {
  voterSession: VoterSessionState;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenAuthModal: () => void;
  onPublicRefresh: () => Promise<void>;
  onSessionUpdated: () => Promise<void>;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AdminDashboard({
  voterSession,
  theme,
  onToggleTheme,
  onOpenAuthModal,
  onPublicRefresh,
  onSessionUpdated,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Category Form
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catIconName, setCatIconName] = useState('Trophy');
  const [catIconUrl, setCatIconUrl] = useState<string | null>(null);
  const [catPositions, setCatPositions] = useState(3);
  const [catIsTeam, setCatIsTeam] = useState(false);
  const [catEnabled, setCatEnabled] = useState(true);
  const [catPoints, setCatPoints] = useState<number[]>([5, 2, 3]);

  // Player & 3D Skin Form
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerBio, setPlayerBio] = useState('');
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerSkinUrl, setPlayerSkinUrl] = useState<string | null>(null);
  const [playerSkinModel, setPlayerSkinModel] = useState<SkinModel>('classic');
  const [playerYouTube, setPlayerYouTube] = useState('');
  const [playerDiscord, setPlayerDiscord] = useState('');

  // Team Form
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);

  // Nominee Assignment Form
  const [nomCategoryId, setNomCategoryId] = useState('');
  const [nomType, setNomType] = useState<'player' | 'team'>('player');
  const [nomTargetId, setNomTargetId] = useState('');

  // Admin Role Form
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'super_admin' | 'awards_admin' | 'moderator'>('awards_admin');

  const getToken = async (): Promise<string> => {
    const supabase = getSupabaseClient();
    const session = (await supabase?.auth.getSession())?.data.session;
    if (!session?.access_token) throw new Error('Authentication session expired.');
    return session.access_token;
  };

  const fetchOverview = async (yearOverride?: string | null) => {
    if (!voterSession.isAdmin) return;
    setLoading(true);
    try {
      const token = await getToken();
      const targetId = yearOverride ?? selectedYearId;
      const url = targetId ? `/api/admin/overview?yearId=${encodeURIComponent(targetId)}` : '/api/admin/overview';
      const json = await apiOrStaticFallback<AdminOverviewData>(
        () => fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
        () => fetchStaticAdminOverview(targetId)
      );
      setData(json);
      if (json.selectedYear?.id && !selectedYearId) {
        setSelectedYearId(json.selectedYear.id);
      }
      if (json.categories?.length > 0 && !nomCategoryId) {
        setNomCategoryId(json.categories[0].id);
      }
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Unable to load admin data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (voterSession.isAdmin) {
      fetchOverview();
    }
  }, [voterSession.isAdmin, selectedYearId]);

  const uploadToStorage = async (
    bucket: 'player-skins' | 'category-icons' | 'avatars',
    file: File
  ): Promise<string> => {
    const token = await getToken();
    const result = await apiOrStaticFallback<{ url: string }>(
      async () => {
        const base64Data = await fileToBase64(file);
        return fetch('/api/admin/storage/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            bucket,
            fileName: file.name,
            contentType: file.type,
            base64Data,
          }),
        });
      },
      () => uploadStaticStorageAsset(bucket, file)
    );
    return result.url;
  };

  const handlePositionCountChange = (count: number) => {
    const clamped = Math.max(1, Math.min(25, count));
    setCatPositions(clamped);
    setCatPoints((prev) => {
      const next = [...prev];
      while (next.length < clamped) {
        const pos = next.length + 1;
        next.push(pos === 1 ? 5 : pos === 2 ? 2 : pos === 3 ? 3 : 0);
      }
      return next.slice(0, clamped);
    });
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.selectedYear) return;
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      const payload = {
        awards_year_id: data.selectedYear.id,
        name: catName,
        description: catDesc,
        icon_name: catIconName,
        icon_url: catIconUrl,
        display_order: editingCatId
          ? data.categories.find((c) => c.id === editingCatId)?.display_order ?? 1
          : data.categories.length + 1,
        winning_positions_count: catPositions,
        is_enabled: catEnabled,
        is_team_category: catIsTeam,
        point_rules: catPoints.map((pts, i) => ({ position: i + 1, points: Number(pts || 0) })),
      };
      await apiOrStaticFallback(
        () =>
          fetch(editingCatId ? `/api/admin/categories/${editingCatId}` : '/api/admin/categories', {
            method: editingCatId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          }),
        () => saveStaticCategory(editingCatId, payload)
      );
      setEditingCatId(null);
      setCatName('');
      setCatDesc('');
      setCatIconUrl(null);
      setCatPositions(3);
      setCatPoints([5, 2, 3]);
      setCatIsTeam(false);
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Category configuration saved and synced publicly.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save category.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReorderCategory = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= data.categories.length) return;
    const reordered = [...data.categories];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, moved);
    const orderedIds = reordered.map((c) => c.id);
    setBusy(true);
    try {
      const token = await getToken();
      await apiOrStaticFallback(
        () =>
          fetch('/api/admin/categories/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ orderedIds }),
          }),
        () => reorderStaticCategories(orderedIds)
      );
      await Promise.all([fetchOverview(), onPublicRefresh()]);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Reorder failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete category "${name}"? Historical or active data in this category will be removed.`)) {
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      await apiOrStaticFallback(
        () =>
          fetch(`/api/admin/categories/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
        () => deleteStaticCategory(id)
      );
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: `Deleted category "${name}".` });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSavePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      const payload = {
        player_name: playerName,
        bio: playerBio,
        avatar_url: playerAvatarUrl,
        skin_url: playerSkinUrl,
        skin_model: playerSkinModel,
        social_links: {
          youtube: playerYouTube || undefined,
          discord: playerDiscord || undefined,
        },
      };
      await apiOrStaticFallback(
        () =>
          fetch(editingPlayerId ? `/api/admin/players/${editingPlayerId}` : '/api/admin/players', {
            method: editingPlayerId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          }),
        () => saveStaticPlayer(editingPlayerId, payload)
      );
      setEditingPlayerId(null);
      setPlayerName('');
      setPlayerBio('');
      setPlayerAvatarUrl(null);
      setPlayerSkinUrl(null);
      setPlayerSkinModel('classic');
      setPlayerYouTube('');
      setPlayerDiscord('');
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Player profile and 3D skin saved.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save player.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      const payload = {
        team_name: teamName,
        description: teamDesc,
        member_player_ids: teamMemberIds,
      };
      await apiOrStaticFallback(
        () =>
          fetch('/api/admin/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          }),
        () => createStaticTeam(payload)
      );
      setTeamName('');
      setTeamDesc('');
      setTeamMemberIds([]);
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Duo / Team created with registered members.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to create team.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAddNominee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.selectedYear) return;
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      const payload = {
        awards_year_id: data.selectedYear.id,
        category_id: nomCategoryId,
        nominee_type: nomType,
        player_id: nomType === 'player' ? nomTargetId : null,
        team_id: nomType === 'team' ? nomTargetId : null,
      };
      await apiOrStaticFallback(
        () =>
          fetch('/api/admin/nominees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          }),
        () => addStaticNominee(payload)
      );
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Nominee assigned to category.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to add nominee.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateYear = async (yearId: string, patch: Partial<AwardsYear>) => {
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      await apiOrStaticFallback(
        () =>
          fetch(`/api/admin/years/${yearId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(patch),
          }),
        () => updateStaticYear(yearId, patch)
      );
      await Promise.all([fetchOverview(yearId), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Awards year updated.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to update year.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCalculateResults = async () => {
    if (!data?.selectedYear) return;
    const yearId = data.selectedYear.id;
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      const json = await apiOrStaticFallback<{ resultsCount: number; rankedPlayersCount: number }>(
        () =>
          fetch(`/api/admin/years/${yearId}/calculate-results`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }),
        () => calculateStaticResults(yearId, false)
      );
      await fetchOverview();
      setBanner({
        type: 'ok',
        text: `Calculated ${json.resultsCount} category placements and ranked ${json.rankedPlayersCount} players.`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Calculation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handlePublishResults = async () => {
    if (!data?.selectedYear) return;
    const yearId = data.selectedYear.id;
    if (
      !window.confirm(
        `Officially publish results for ${data.selectedYear.title}? All category winners, vote counts, and the Overall Player leaderboard will become publicly visible.`
      )
    ) {
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const token = await getToken();
      await apiOrStaticFallback(
        () =>
          fetch(`/api/admin/years/${yearId}/publish`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }),
        () => calculateStaticResults(yearId, true)
      );
      await Promise.all([fetchOverview(), onPublicRefresh()]);
      setBanner({ type: 'ok', text: 'Official results calculated and published publicly!' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Publish failed.' });
    } finally {
      setBusy(false);
    }
  };

  if (!voterSession.isAdmin) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] p-8 text-center">
          <Lock className="mx-auto h-10 w-10 text-[var(--mc-accent)]" />
          <h1 className="mt-4 font-display text-2xl font-bold text-[var(--mc-ink)]">
            Protected Administrator Console
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--mc-ink-muted)]">
            {voterSession.voter
              ? `Signed in as ${voterSession.voter.google_email || voterSession.voter.display_name}. This account does not have administrator permissions.`
              : 'Only authorized MultiCraft Awards administrators can access this console.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="h-10 rounded-lg bg-[var(--mc-accent)] px-5 text-sm font-semibold text-[var(--mc-accent-contrast)] transition-colors hover:bg-[var(--mc-accent-hover)]"
            >
              {voterSession.voter ? 'Switch Account' : 'Sign In'}
            </button>
          </div>
          {banner && (
            <p className="mt-4 text-xs font-medium text-[var(--mc-accent)]">{banner.text}</p>
          )}
        </div>
      </main>
    );
  }

  const navItems: Array<{ id: AdminTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'Overview & Analytics', icon: BarChart3 },
    { id: 'categories', label: 'Categories & Points', icon: FolderKanban },
    { id: 'players', label: 'Players, Teams & 3D Skins', icon: Users },
    { id: 'nominees', label: 'Nominees', icon: UserPlus },
    { id: 'results', label: 'Results & Publish', icon: Trophy },
    { id: 'security', label: 'Roles & Audit Logs', icon: History },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:px-8">
      {/* Sidebar */}
      <aside className="w-full shrink-0 lg:w-64">
        <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
          <div className="mb-4 border-b border-[var(--mc-border)] pb-3">
            <p className="text-xs font-semibold text-[var(--mc-accent)]">Admin Workspace</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--mc-ink)]">
              {voterSession.voter?.display_name}
            </p>
            <p className="text-xs text-[var(--mc-ink-muted)]">{voterSession.adminRole}</p>
          </div>

          <nav className="flex flex-row gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[var(--mc-accent-soft)] text-[var(--mc-accent)] border border-[var(--mc-accent-border)]'
                      : 'text-[var(--mc-ink-muted)] hover:bg-[var(--mc-surface-elevated)] hover:text-[var(--mc-ink)] border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 border-t border-[var(--mc-border)] pt-3">
            <button
              type="button"
              onClick={onToggleTheme}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--mc-ink)]"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5 text-[var(--mc-accent)]" /> : <Moon className="h-3.5 w-3.5 text-[var(--mc-accent)]" />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="min-w-0 flex-1 space-y-6">
        {/* Context Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] px-6 py-4">
          <div>
            <p className="text-xs text-[var(--mc-ink-muted)]">
              Admin / {navItems.find((n) => n.id === activeTab)?.label}
            </p>
            <h1 className="font-display text-xl font-bold text-[var(--mc-ink)]">
              {data?.selectedYear?.title || 'MultiCraft Awards Administration'}
            </h1>
          </div>

          {data?.selectedYear && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={data.selectedYear.status}
                onChange={(e) =>
                  handleUpdateYear(data.selectedYear!.id, { status: e.target.value as AwardsYearStatus })
                }
                aria-label="Edition status"
                className="h-9 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs font-semibold text-[var(--mc-ink)]"
              >
                <option value="draft">Draft</option>
                <option value="voting_active">Voting Active</option>
                <option value="voting_closed">Voting Closed</option>
                <option value="results_published">Results Published</option>
              </select>

              <select
                value={data.selectedYear.tie_policy}
                onChange={(e) =>
                  handleUpdateYear(data.selectedYear!.id, { tie_policy: e.target.value as TiePolicy })
                }
                aria-label="Tie policy"
                className="h-9 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
              >
                <option value="shared_rank">Tie: Shared Rank</option>
                <option value="earliest_vote">Tie: Earliest Milestone</option>
                <option value="admin_tiebreak">Tie: Admin Review</option>
              </select>

              <button
                type="button"
                onClick={() =>
                  handleUpdateYear(data.selectedYear!.id, {
                    allow_vote_editing: !data.selectedYear!.allow_vote_editing,
                  })
                }
                className="h-9 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs font-medium text-[var(--mc-ink)]"
              >
                {data.selectedYear.allow_vote_editing ? 'Vote Edit: On' : 'Vote Edit: Locked'}
              </button>
            </div>
          )}
        </div>

        {banner && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] px-4 py-3 text-xs font-medium text-[var(--mc-ink)]">
            {banner.type === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-[var(--mc-accent)]" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {loading || !data ? (
          <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-10 text-center text-sm text-[var(--mc-ink-muted)]">
            Loading administration workspace...
          </div>
        ) : (
          <>
            {/* 1. OVERVIEW & PRIVATE ANALYTICS */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
                    <p className="text-xs text-[var(--mc-ink-muted)]">Total Votes</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[var(--mc-accent)]">
                      {data.stats.totalVotes}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
                    <p className="text-xs text-[var(--mc-ink-muted)]">Unique Voters</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[var(--mc-ink)]">
                      {data.stats.uniqueVoters}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
                    <p className="text-xs text-[var(--mc-ink-muted)]">Categories</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[var(--mc-ink)]">
                      {data.stats.totalCategories}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
                    <p className="text-xs text-[var(--mc-ink-muted)]">Nominees</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[var(--mc-ink)]">
                      {data.stats.totalNominees}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4">
                    <p className="text-xs text-[var(--mc-ink-muted)]">Registered Players</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[var(--mc-ink)]">
                      {data.stats.totalPlayers}
                    </p>
                  </div>
                </div>

                {/* Private Live Vote Telemetry */}
                <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
                  <h2 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                    Private Live Voting Standings (Admin Only)
                  </h2>
                  <p className="mt-1 text-xs text-[var(--mc-ink-muted)]">
                    Strictly invisible to the public API until you officially publish results.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {data.categories.map((cat) => {
                      const catVotes = data.votesSummary
                        .filter((v) => v.category_id === cat.id)
                        .sort((a, b) => b.count - a.count);
                      return (
                        <div
                          key={cat.id}
                          className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-4"
                        >
                          <p className="font-display text-sm font-semibold text-[var(--mc-ink)]">{cat.name}</p>
                          {catVotes.length === 0 ? (
                            <p className="mt-2 text-xs text-[var(--mc-ink-muted)]">No votes cast yet.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5 text-xs">
                              {catVotes.map((cv) => {
                                const nom = data.nominees.find((n) => n.id === cv.nominee_id);
                                return (
                                  <li key={cv.nominee_id} className="flex justify-between">
                                    <span className="text-[var(--mc-ink)]">{nom?.display_name || 'Nominee'}</span>
                                    <span className="font-mono-tabular font-semibold text-[var(--mc-accent)]">
                                      {cv.count} votes
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 2. DYNAMIC CATEGORIES & POINT RULES */}
            {activeTab === 'categories' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <form
                  onSubmit={handleSaveCategory}
                  className="space-y-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 lg:col-span-5"
                >
                  <h2 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                    {editingCatId ? 'Edit Category' : 'Create Dynamic Category'}
                  </h2>

                  <div>
                    <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">Category Name</label>
                    <input
                      type="text"
                      required
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                      placeholder="e.g. Best Parkour Runner"
                      className="mt-1 h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">Description</label>
                    <textarea
                      rows={2}
                      value={catDesc}
                      onChange={(e) => setCatDesc(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] p-3 text-sm text-[var(--mc-ink)]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">Icon Preset</label>
                      <select
                        value={catIconName}
                        onChange={(e) => setCatIconName(e.target.value)}
                        className="mt-1 h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                      >
                        {CATEGORY_ICON_OPTIONS.map((icon) => (
                          <option key={icon} value={icon}>
                            {icon}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">
                        Winning Positions
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={25}
                        value={catPositions}
                        onChange={(e) => handlePositionCountChange(Number(e.target.value))}
                        className="mt-1 h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm font-mono-tabular text-[var(--mc-ink)]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">
                      Upload Custom Icon (Optional)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusy(true);
                        try {
                          const url = await uploadToStorage('category-icons', file);
                          setCatIconUrl(url);
                        } catch (err) {
                          setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Icon upload failed.' });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="mt-1 block w-full text-xs text-[var(--mc-ink-muted)]"
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold text-[var(--mc-ink-muted)]">
                      Independent Position Points
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {catPoints.map((pts, idx) => (
                        <label
                          key={idx}
                          className="flex flex-col rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-2 text-xs"
                        >
                          <span className="text-[var(--mc-ink-muted)]">#{idx + 1}</span>
                          <input
                            type="number"
                            min={0}
                            value={pts}
                            onChange={(e) => {
                              const copy = [...catPoints];
                              copy[idx] = Number(e.target.value);
                              setCatPoints(copy);
                            }}
                            className="mt-1 bg-transparent font-mono-tabular font-semibold text-[var(--mc-ink)] outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[var(--mc-ink)]">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={catIsTeam}
                        onChange={(e) => setCatIsTeam(e.target.checked)}
                      />
                      Duo / Team Category
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={catEnabled}
                        onChange={(e) => setCatEnabled(e.target.checked)}
                      />
                      Enabled Publicly
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-10 flex-1 rounded-lg bg-[var(--mc-accent)] px-4 text-xs font-semibold text-[var(--mc-accent-contrast)]"
                    >
                      {editingCatId ? 'Update Category' : 'Add Category'}
                    </button>
                    {editingCatId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(null);
                          setCatName('');
                          setCatDesc('');
                          setCatPositions(3);
                          setCatPoints([5, 2, 3]);
                        }}
                        className="h-10 rounded-lg border border-[var(--mc-border-strong)] px-4 text-xs text-[var(--mc-ink)]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>

                <div className="space-y-3 lg:col-span-7">
                  {data.categories.map((cat, index) => (
                    <div
                      key={cat.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-accent)]">
                          <CategoryIcon iconName={cat.icon_name} iconUrl={cat.icon_url} className="h-5 w-5" />
                        </span>
                        <div>
                          <p className="font-display text-sm font-bold text-[var(--mc-ink)]">
                            {cat.name} {!cat.is_enabled ? '(Disabled)' : ''}
                          </p>
                          <p className="font-mono-tabular text-xs text-[var(--mc-ink-muted)]">
                            Top {cat.winning_positions_count} ·{' '}
                            {(cat.point_rules || [])
                              .slice(0, 4)
                              .map((r) => `#${r.position}:${r.points}`)
                              .join(' ')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleReorderCategory(index, -1)}
                          disabled={index === 0 || busy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--mc-border)] text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)] disabled:opacity-30"
                          aria-label="Move category up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReorderCategory(index, 1)}
                          disabled={index === data.categories.length - 1 || busy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--mc-border)] text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)] disabled:opacity-30"
                          aria-label="Move category down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(cat.id);
                            setCatName(cat.name);
                            setCatDesc(cat.description);
                            setCatIconName(cat.icon_name);
                            setCatIconUrl(cat.icon_url);
                            setCatPositions(cat.winning_positions_count);
                            setCatIsTeam(cat.is_team_category);
                            setCatEnabled(cat.is_enabled);
                            const pts: number[] = [];
                            for (let p = 1; p <= cat.winning_positions_count; p += 1) {
                              const found = cat.point_rules?.find((r) => r.position === p);
                              pts.push(found ? found.points : 0);
                            }
                            setCatPoints(pts);
                          }}
                          className="h-8 rounded-md border border-[var(--mc-border-strong)] px-3 text-xs font-medium text-[var(--mc-ink)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat.id, cat.name)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--mc-border)] text-[var(--mc-ink-muted)] hover:text-[var(--mc-accent)]"
                          aria-label={`Delete ${cat.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. PLAYERS, TEAMS & 3D SKIN STUDIO */}
            {activeTab === 'players' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <form
                    onSubmit={handleSavePlayer}
                    className="space-y-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 lg:col-span-6"
                  >
                    <h2 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                      {editingPlayerId ? 'Edit Player & 3D Skin' : 'Register Player & Upload 3D Skin'}
                    </h2>

                    <input
                      type="text"
                      required
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Player Name (unique community identity)"
                      className="h-10 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                    />
                    <textarea
                      rows={2}
                      value={playerBio}
                      onChange={(e) => setPlayerBio(e.target.value)}
                      placeholder="Player biography & highlights..."
                      className="w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] p-3 text-sm text-[var(--mc-ink)]"
                    />

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="url"
                        value={playerYouTube}
                        onChange={(e) => setPlayerYouTube(e.target.value)}
                        placeholder="YouTube URL"
                        className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                      />
                      <input
                        type="text"
                        value={playerDiscord}
                        onChange={(e) => setPlayerDiscord(e.target.value)}
                        placeholder="Discord Handle / Invite"
                        className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-4 sm:grid-cols-2">
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--mc-ink)]">
                          <Upload className="h-3.5 w-3.5 text-[var(--mc-accent)]" />
                          Minecraft PNG Skin
                        </label>
                        <input
                          type="file"
                          accept="image/png"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setBusy(true);
                            try {
                              const url = await uploadToStorage('player-skins', file);
                              setPlayerSkinUrl(url);
                            } catch (err) {
                              setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Skin upload failed.' });
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="mt-2 block w-full text-xs text-[var(--mc-ink-muted)]"
                        />
                        {playerSkinUrl && (
                          <button
                            type="button"
                            onClick={() => setPlayerSkinUrl(null)}
                            className="mt-2 text-xs font-medium text-[var(--mc-accent)] underline"
                          >
                            Remove Skin
                          </button>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[var(--mc-ink)]">Skin Model Type</label>
                        <select
                          value={playerSkinModel}
                          onChange={(e) => setPlayerSkinModel(e.target.value as SkinModel)}
                          className="mt-2 h-9 w-full rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface)] px-3 text-xs text-[var(--mc-ink)]"
                        >
                          <option value="classic">Classic (4px arms)</option>
                          <option value="slim">Slim (3px arms)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--mc-ink-muted)]">
                        Profile Avatar Image (Optional)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setBusy(true);
                          try {
                            const url = await uploadToStorage('avatars', file);
                            setPlayerAvatarUrl(url);
                          } catch (err) {
                            setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Avatar upload failed.' });
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="mt-1 block w-full text-xs text-[var(--mc-ink-muted)]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="h-10 w-full rounded-lg bg-[var(--mc-accent)] px-4 text-xs font-semibold text-[var(--mc-accent-contrast)]"
                    >
                      {editingPlayerId ? 'Update Player Identity' : 'Create Player Identity'}
                    </button>
                  </form>

                  <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 lg:col-span-6">
                    <h3 className="mb-3 font-display text-sm font-semibold text-[var(--mc-ink-muted)]">
                      Live 3D Skin Preview
                    </h3>
                    <SkinViewer3D
                      skinUrl={playerSkinUrl}
                      skinModel={playerSkinModel}
                      playerName={playerName || 'Preview Player'}
                      height={360}
                    />
                  </div>
                </div>

                {/* Registered Players Directory */}
                <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
                  <h3 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                    Registered Players ({data.players.length})
                  </h3>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.players.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] p-3.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-sm text-[var(--mc-ink)]">{p.player_name}</p>
                          <p className="text-xs text-[var(--mc-ink-muted)]">
                            {p.skin_url ? `3D ${p.skin_model} skin` : 'No skin'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlayerId(p.id);
                            setPlayerName(p.player_name);
                            setPlayerBio(p.bio);
                            setPlayerAvatarUrl(p.avatar_url);
                            setPlayerSkinUrl(p.skin_url);
                            setPlayerSkinModel(p.skin_model);
                            setPlayerYouTube(p.social_links?.youtube || '');
                            setPlayerDiscord(p.social_links?.discord || '');
                          }}
                          className="h-8 rounded-md border border-[var(--mc-border-strong)] px-3 text-xs font-medium text-[var(--mc-ink)]"
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Duo / Team Builder */}
                <form
                  onSubmit={handleCreateTeam}
                  className="space-y-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6"
                >
                  <h3 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                    Create Duo / Team & Register Members
                  </h3>
                  <p className="text-xs text-[var(--mc-ink-muted)]">
                    Every registered member listed on a winning team receives the FULL team award points in the Overall
                    Player leaderboard.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <input
                      type="text"
                      required
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="Duo or Team Name"
                      className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                    />
                    <input
                      type="text"
                      value={teamDesc}
                      onChange={(e) => setTeamDesc(e.target.value)}
                      placeholder="Team description"
                      className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-sm text-[var(--mc-ink)]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.players.map((p) => {
                      const checked = teamMemberIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setTeamMemberIds((prev) =>
                              checked ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                            )
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                            checked
                              ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] text-[var(--mc-accent)]'
                              : 'border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-ink-muted)]'
                          }`}
                        >
                          {checked ? '✓ ' : '+ '}
                          {p.player_name}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="submit"
                    disabled={busy || teamMemberIds.length === 0}
                    className="h-10 rounded-lg bg-[var(--mc-accent)] px-5 text-xs font-semibold text-[var(--mc-accent-contrast)] disabled:opacity-40"
                  >
                    Save Duo / Team ({teamMemberIds.length} members)
                  </button>
                </form>
              </div>
            )}

            {/* 5. NOMINEES ASSIGNMENT */}
            {activeTab === 'nominees' && (
              <div className="space-y-6">
                <form
                  onSubmit={handleAddNominee}
                  className="grid grid-cols-1 gap-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 sm:grid-cols-4"
                >
                  <select
                    value={nomCategoryId}
                    onChange={(e) => setNomCategoryId(e.target.value)}
                    className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                  >
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={nomType}
                    onChange={(e) => {
                      setNomType(e.target.value as 'player' | 'team');
                      setNomTargetId('');
                    }}
                    className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                  >
                    <option value="player">Individual Player</option>
                    <option value="team">Duo / Team</option>
                  </select>

                  <select
                    required
                    value={nomTargetId}
                    onChange={(e) => setNomTargetId(e.target.value)}
                    className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                  >
                    <option value="">Select {nomType === 'player' ? 'Player' : 'Team'}...</option>
                    {nomType === 'player'
                      ? data.players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.player_name}
                          </option>
                        ))
                      : data.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.team_name}
                          </option>
                        ))}
                  </select>

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--mc-accent)] px-4 text-xs font-semibold text-[var(--mc-accent-contrast)]"
                  >
                    <Plus className="h-4 w-4" />
                    Add Nominee
                  </button>
                </form>

                <div className="space-y-2">
                  {data.nominees.map((nom) => {
                    const cat = data.categories.find((c) => c.id === nom.category_id);
                    return (
                      <div
                        key={nom.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] px-4 py-3 text-sm"
                      >
                        <div>
                          <span className="font-semibold text-[var(--mc-ink)]">{nom.display_name}</span>
                          <span className="mx-2 text-[var(--mc-ink-muted)]">·</span>
                          <span className="text-xs text-[var(--mc-accent)]">{cat?.name || 'Category'}</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Remove ${nom.display_name} from ${cat?.name}?`)) return;
                            const token = await getToken();
                            await apiOrStaticFallback(
                              () =>
                                fetch(`/api/admin/nominees/${nom.id}`, {
                                  method: 'DELETE',
                                  headers: { Authorization: `Bearer ${token}` },
                                }),
                              () => deleteStaticNominee(nom.id)
                            );
                            await Promise.all([fetchOverview(), onPublicRefresh()]);
                          }}
                          className="text-xs text-[var(--mc-ink-muted)] hover:text-[var(--mc-accent)]"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 6. RESULTS CALCULATION & PUBLICATION */}
            {activeTab === 'results' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[var(--mc-ink)]">
                      Automated Calculation & Official Publication
                    </h2>
                    <p className="mt-1 text-xs text-[var(--mc-ink-muted)]">
                      Calculates category winners, applies tie rules, credits individual & full Duo/Team member points,
                      and builds the Overall Player leaderboard without duplicate points.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleCalculateResults}
                      className="h-10 rounded-lg border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] px-4 text-xs font-semibold text-[var(--mc-accent)]"
                    >
                      Recalculate Preview
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handlePublishResults}
                      className="h-10 rounded-lg bg-[var(--mc-accent)] px-5 text-xs font-semibold text-[var(--mc-accent-contrast)]"
                    >
                      Officially Publish Results
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
                  <h3 className="font-display text-base font-bold text-[var(--mc-ink)]">
                    Overall Player Leaderboard Preview ({data.overallRankings.length})
                  </h3>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--mc-border)] text-[var(--mc-ink-muted)]">
                          <th className="py-2">Rank</th>
                          <th className="py-2">Player</th>
                          <th className="py-2 text-right">Wins</th>
                          <th className="py-2 text-right">Total Points</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--mc-border)]">
                        {data.overallRankings.map((r) => (
                          <tr key={r.id}>
                            <td className="py-2.5 font-mono-tabular font-semibold text-[var(--mc-accent)]">
                              #{r.rank_position}
                            </td>
                            <td className="py-2.5 font-medium text-[var(--mc-ink)]">
                              {r.player?.player_name || r.player_id}
                            </td>
                            <td className="py-2.5 text-right font-mono-tabular text-[var(--mc-ink)]">
                              {r.categories_won}
                            </td>
                            <td className="py-2.5 text-right font-mono-tabular font-bold text-[var(--mc-accent)]">
                              {r.total_points}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* 8. ADMIN ROLES & AUDIT LOGS */}
            {activeTab === 'security' && (
              <div className="space-y-6">
                {voterSession.adminRole === 'super_admin' && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        const token = await getToken();
                        await apiOrStaticFallback(
                          () =>
                            fetch('/api/admin/roles', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ email: newAdminEmail, role: newAdminRole }),
                            }),
                          () => grantStaticAdminRole(newAdminEmail, newAdminRole)
                        );
                        setNewAdminEmail('');
                        await fetchOverview();
                        setBanner({ type: 'ok', text: 'Administrator role updated.' });
                      } catch (err) {
                        setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Role update failed.' });
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="grid grid-cols-1 gap-3 rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6 sm:grid-cols-4"
                  >
                    <input
                      type="email"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)] sm:col-span-2"
                    />
                    <select
                      value={newAdminRole}
                      onChange={(e) => setNewAdminRole(e.target.value as 'super_admin' | 'awards_admin' | 'moderator')}
                      className="h-10 rounded-lg border border-[var(--mc-border-strong)] bg-[var(--mc-surface-elevated)] px-3 text-xs text-[var(--mc-ink)]"
                    >
                      <option value="awards_admin">Awards Admin</option>
                      <option value="moderator">Moderator</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-10 rounded-lg bg-[var(--mc-accent)] px-4 text-xs font-semibold text-[var(--mc-accent-contrast)]"
                    >
                      Grant Admin Role
                    </button>
                  </form>
                )}

                <div className="rounded-2xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-6">
                  <h3 className="font-display text-base font-bold text-[var(--mc-ink)]">Audit Trail (Latest 100)</h3>
                  <div className="mt-4 max-h-96 overflow-y-auto divide-y divide-[var(--mc-border)] text-xs">
                    {data.auditLogs.map((log) => (
                      <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div>
                          <span className="font-mono-tabular font-semibold text-[var(--mc-accent)]">{log.action}</span>
                          <span className="mx-2 text-[var(--mc-ink-muted)]">·</span>
                          <span className="text-[var(--mc-ink)]">{log.actor_email || 'system'}</span>
                        </div>
                        <span className="font-mono-tabular text-[var(--mc-ink-muted)]">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
