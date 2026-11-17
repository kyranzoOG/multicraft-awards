import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function isServerSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      !supabaseUrl.includes('your-project-ref') &&
      !supabaseAnonKey.includes('your-supabase-anon-key')
  );
}

export function hasServiceRoleKey(): boolean {
  return Boolean(
    supabaseServiceRoleKey && !supabaseServiceRoleKey.includes('your-supabase-service-role-key')
  );
}

let anonClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function getSupabasePublicClient(): SupabaseClient | null {
  if (!isServerSupabaseConfigured()) return null;
  if (!anonClient) {
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anonClient;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!isServerSupabaseConfigured() || !hasServiceRoleKey()) return null;
  if (!adminClient) {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export interface CategoryBlueprint {
  slug: string;
  name: string;
  description: string;
  icon_name: string;
  display_order: number;
  winning_positions_count: number;
  is_team_category: boolean;
  point_rules: Array<{ position: number; points: number }>;
}

export const DEFAULT_CATEGORY_BLUEPRINTS: CategoryBlueprint[] = [
  {
    slug: 'best-editor',
    name: 'Best Editor',
    description:
      'Recognizing cinematic pacing, visual storytelling, and sound design in MultiCraft video edits.',
    icon_name: 'Film',
    display_order: 1,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-streamer',
    name: 'Best Streamer',
    description:
      'Honoring live broadcast consistency, community engagement, and entertaining MultiCraft streams.',
    icon_name: 'Radio',
    display_order: 2,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-mobile-content-creator',
    name: 'Best Mobile Content Creator',
    description:
      'Celebrating standout MultiCraft creators producing, editing, and playing natively on mobile.',
    icon_name: 'Smartphone',
    display_order: 3,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-builder',
    name: 'Best Builder',
    description:
      'Awarded for architectural scale, terrain mastery, block palette artistry, and worldcraft.',
    icon_name: 'Blocks',
    display_order: 4,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-pvper',
    name: 'Best PvPer',
    description:
      'Honoring mechanical precision, combat awareness, and competitive arena dominance.',
    icon_name: 'Swords',
    display_order: 5,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-duo-team',
    name: 'Best Duo / Team',
    description: 'Celebrating synchronized partnerships and collaborative squads across MultiCraft.',
    icon_name: 'Users',
    display_order: 6,
    winning_positions_count: 3,
    is_team_category: true,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-youtuber',
    name: 'Best YouTuber',
    description: 'Recognizing the top long-form MultiCraft video creators shaping the community.',
    icon_name: 'Youtube',
    display_order: 7,
    winning_positions_count: 10,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
      { position: 4, points: 0 },
      { position: 5, points: 0 },
      { position: 6, points: 0 },
      { position: 7, points: 0 },
      { position: 8, points: 0 },
      { position: 9, points: 0 },
      { position: 10, points: 0 },
    ],
  },
  {
    slug: 'best-fpv-player',
    name: 'Best FPV Player',
    description: 'Honoring first-person movement mastery, precision parkour, and aerial gameplay.',
    icon_name: 'Crosshair',
    display_order: 8,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
  {
    slug: 'best-bluestoner',
    name: 'Best Bluestoner',
    description:
      'Awarded for ingenious MultiCraft Bluestone circuitry, automation, and mechanical contraptions.',
    icon_name: 'Cpu',
    display_order: 9,
    winning_positions_count: 3,
    is_team_category: false,
    point_rules: [
      { position: 1, points: 5 },
      { position: 2, points: 2 },
      { position: 3, points: 3 },
    ],
  },
];
