import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AwardsYear,
  Category,
  CategoryResult,
  Nominee,
  OverallRanking,
  PublicBootstrapPayload,
} from '../types/awards';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
) as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-ref') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return clientInstance;
}

export function getDefaultCalendarYearBlueprint(): PublicBootstrapPayload {
  const yearNum = new Date().getFullYear();
  const yearId = `blueprint-${yearNum}`;
  const nowIso = new Date().toISOString();

  const selectedYear: AwardsYear = {
    id: yearId,
    year_label: yearNum,
    title: `MultiCraft Awards ${yearNum}`,
    description: `Annual MultiCraft Build and Mine community awards for ${yearNum}.`,
    status: 'voting_active',
    is_active: true,
    allow_vote_editing: false,
    tie_policy: 'shared_rank',
    voting_starts_at: null,
    voting_ends_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const rawBlueprints = [
    { slug: 'best-editor', name: 'Best Editor', icon_name: 'Film', count: 3, team: false },
    { slug: 'best-streamer', name: 'Best Streamer', icon_name: 'Radio', count: 3, team: false },
    { slug: 'best-mobile-content-creator', name: 'Best Mobile Content Creator', icon_name: 'Smartphone', count: 3, team: false },
    { slug: 'best-builder', name: 'Best Builder', icon_name: 'Blocks', count: 3, team: false },
    { slug: 'best-pvper', name: 'Best PvPer', icon_name: 'Swords', count: 3, team: false },
    { slug: 'best-duo-team', name: 'Best Duo / Team', icon_name: 'Users', count: 3, team: true },
    { slug: 'best-youtuber', name: 'Best YouTuber', icon_name: 'Youtube', count: 10, team: false },
    { slug: 'best-fpv-player', name: 'Best FPV Player', icon_name: 'Crosshair', count: 3, team: false },
    { slug: 'best-bluestoner', name: 'Best Bluestoner', icon_name: 'Cpu', count: 3, team: false },
  ];

  const categories: Category[] = rawBlueprints.map((item, idx) => ({
    id: `blueprint-cat-${item.slug}`,
    awards_year_id: yearId,
    name: item.name,
    slug: item.slug,
    description: `${item.name} — MultiCraft Awards ${yearNum}`,
    icon_name: item.icon_name,
    icon_url: null,
    display_order: idx + 1,
    winning_positions_count: item.count,
    is_enabled: true,
    is_team_category: item.team,
    point_rules: Array.from({ length: item.count }, (_, pIdx) => {
      const pos = pIdx + 1;
      const pts = pos === 1 ? 5 : pos === 2 ? 2 : pos === 3 ? 3 : 0;
      return {
        id: `blueprint-rule-${item.slug}-${pos}`,
        category_id: `blueprint-cat-${item.slug}`,
        position: pos,
        points: pts,
      };
    }),
    created_at: nowIso,
    updated_at: nowIso,
  }));

  return {
    supabaseConfigured: isSupabaseConfigured,
    years: [selectedYear],
    selectedYear,
    categories,
    nominees: [],
    resultsPublished: false,
    categoryResults: null,
    overallRankings: null,
  };
}

/**
 * Direct static-hosting fallback for GitHub Pages (when no Express /api backend is present).
 * Relies strictly on Supabase RLS policies so only enabled categories, nominees, and published
 * results are visible publicly.
 */
export async function fetchStaticPublicBootstrap(yearIdOverride?: string | null): Promise<PublicBootstrapPayload> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return getDefaultCalendarYearBlueprint();
  }

  try {
    const { data: yearsData, error: yearsErr } = await supabase
      .from('awards_years')
      .select('*')
      .order('year_label', { ascending: false });

    if (yearsErr || !yearsData || yearsData.length === 0) {
      return getDefaultCalendarYearBlueprint();
    }

    const years = yearsData as AwardsYear[];
    const currentYearNum = new Date().getFullYear();
    const selectedYear =
      (yearIdOverride ? years.find((y) => y.id === yearIdOverride) : null) ||
      years.find((y) => y.year_label === currentYearNum) ||
      years.find((y) => y.is_active) ||
      years[0];

    const [{ data: catsData }, { data: nomsData }] = await Promise.all([
      supabase
        .from('categories')
        .select('*, point_rules:category_point_rules(*)')
        .eq('awards_year_id', selectedYear.id)
        .eq('is_enabled', true)
        .order('display_order', { ascending: true }),
      supabase
        .from('nominees')
        .select('*, player:players(*), team:teams(*, members:team_members(*, player:players(*)))')
        .eq('awards_year_id', selectedYear.id)
        .order('display_name', { ascending: true }),
    ]);

    const categories = ((catsData || []) as Category[]).map((c) => ({
      ...c,
      point_rules: [...(c.point_rules || [])].sort((a, b) => a.position - b.position),
    }));
    const nominees = (nomsData || []) as Nominee[];
    const resultsPublished = selectedYear.status === 'results_published';

    let categoryResults: CategoryResult[] | null = null;
    let overallRankings: OverallRanking[] | null = null;

    if (resultsPublished) {
      const [{ data: resData }, { data: rankData }] = await Promise.all([
        supabase
          .from('category_results')
          .select('*, nominee:nominees(*, player:players(*), team:teams(*, members:team_members(*, player:players(*))))')
          .eq('awards_year_id', selectedYear.id)
          .order('position', { ascending: true }),
        supabase
          .from('overall_rankings')
          .select('*, player:players(*)')
          .eq('awards_year_id', selectedYear.id)
          .order('rank_position', { ascending: true }),
      ]);
      categoryResults = (resData || []) as CategoryResult[];
      overallRankings = (rankData || []) as OverallRanking[];
    }

    return {
      supabaseConfigured: true,
      years,
      selectedYear,
      categories,
      nominees,
      resultsPublished,
      categoryResults,
      overallRankings,
    };
  } catch {
    return getDefaultCalendarYearBlueprint();
  }
}

export async function completeOAuthFromParams(search: string, hash: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(search.replace(/^\?/, ''));

  const errorDesc =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error');

  if (errorDesc) {
    throw new Error(decodeURIComponent(errorDesc));
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const code = searchParams.get('code');

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return true;
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  return false;
}

export async function getGoogleOAuthUrl(): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase credentials are not configured yet.');
  }

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const redirectTo = `${window.location.origin}${basePath}/auth/callback`;

  const response = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: 'openid email profile',
      queryParams: {
        prompt: 'select_account',
      },
    },
  });

  if (response.error || !response.data?.url) {
    throw new Error(response.error?.message || 'Failed to start Google Sign-In.');
  }

  return response.data.url;
}

export async function openGoogleOAuthPopup(
  precomputedUrl?: string
): Promise<{ blockedUrl?: string }> {
  const authUrl = precomputedUrl || (await getGoogleOAuthUrl());

  const popup = window.open(
    authUrl,
    'multicraft_google_oauth',
    'width=560,height=700,menubar=no,toolbar=no,location=yes'
  );

  if (!popup) {
    return { blockedUrl: authUrl };
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    let timeoutId = 0;
    let closeWatcherId = 0;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(closeWatcherId);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorageEvent);
      try {
        channel?.close();
      } catch {
        // Ignore close errors
      }
    };

    const handlePayload = async (data: { type?: string; hash?: string; search?: string } | null) => {
      if (settled || !data || data.type !== 'MULTICRAFT_OAUTH_CALLBACK') return;
      settled = true;
      cleanup();
      try {
        window.localStorage.removeItem('mc_oauth_callback');
      } catch {
        // Ignore storage errors
      }
      try {
        const completed = await completeOAuthFromParams(data.search || '', data.hash || '');
        if (!completed) {
          reject(new Error('No authentication session returned from Google sign-in.'));
          return;
        }
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to complete Google sign-in.'));
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      void handlePayload(event.data);
    };

    const onStorageEvent = (event: StorageEvent) => {
      if (event.key !== 'mc_oauth_callback' || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { type?: string; hash?: string; search?: string };
        void handlePayload(parsed);
      } catch {
        // Ignore invalid storage payload
      }
    };

    window.addEventListener('message', onWindowMessage);
    window.addEventListener('storage', onStorageEvent);

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('multicraft_oauth_channel');
        channel.onmessage = (event) => {
          void handlePayload(event.data);
        };
      }
    } catch {
      // Ignore BroadcastChannel fallback errors
    }

    closeWatcherId = window.setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        window.setTimeout(() => {
          if (settled) return;
          try {
            const raw = window.localStorage.getItem('mc_oauth_callback');
            if (raw) {
              const parsed = JSON.parse(raw) as { type?: string; hash?: string; search?: string };
              void handlePayload(parsed);
              return;
            }
          } catch {
            // Ignore storage read
          }
          settled = true;
          cleanup();
          reject(new Error('Sign-in window was closed before completing Google login.'));
        }, 500);
      }
    }, 400);

    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Google sign-in timed out. Please try again.'));
    }, 180000);
  });

  return {};
}
