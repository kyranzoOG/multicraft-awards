export type AwardsYearStatus =
  | 'draft'
  | 'voting_active'
  | 'voting_closed'
  | 'results_published'
  | 'archived';

export type TiePolicy = 'shared_rank' | 'earliest_vote' | 'admin_tiebreak';

export type SkinModel = 'classic' | 'slim';

export type EligibilityStatus = 'pending' | 'approved' | 'rejected' | 'ineligible';

export type AuthProvider = 'google' | 'discord';

export type AdminRoleType = 'super_admin' | 'awards_admin' | 'moderator';

export interface AwardsYear {
  id: string;
  year_label: number;
  title: string;
  description: string;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  status: AwardsYearStatus;
  tie_policy: TiePolicy;
  allow_vote_editing: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryPointRule {
  id: string;
  category_id: string;
  position: number;
  points: number;
}

export interface Category {
  id: string;
  awards_year_id: string;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  icon_name: string;
  display_order: number;
  winning_positions_count: number;
  is_enabled: boolean;
  is_team_category: boolean;
  created_at: string;
  updated_at: string;
  point_rules?: CategoryPointRule[];
}

export interface SocialLinks {
  youtube?: string;
  discord?: string;
  twitch?: string;
  tiktok?: string;
  x?: string;
  website?: string;
}

export interface Player {
  id: string;
  player_name: string;
  unique_slug: string;
  avatar_url: string | null;
  bio: string;
  social_links: SocialLinks;
  skin_url: string | null;
  skin_model: SkinModel;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  player_id: string;
  role_label: string;
  player?: Player;
}

export interface Team {
  id: string;
  team_name: string;
  unique_slug: string;
  avatar_url: string | null;
  description: string;
  social_links: SocialLinks;
  created_at: string;
  updated_at: string;
  members?: TeamMember[];
}

export interface Nominee {
  id: string;
  awards_year_id: string;
  category_id: string;
  nominee_type: 'player' | 'team';
  player_id: string | null;
  team_id: string | null;
  display_name: string;
  description: string;
  profile_image_url: string | null;
  social_links: SocialLinks;
  skin_url: string | null;
  skin_model: SkinModel;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  player?: Player | null;
  team?: Team | null;
}

export interface VoterIdentity {
  id: string;
  auth_user_id: string;
  google_provider_id: string | null;
  google_email: string | null;
  google_email_verified: boolean;
  discord_provider_id: string | null;
  discord_username: string | null;
  discord_email: string | null;
  discord_email_verified: boolean;
  discord_created_at: string | null;
  primary_provider: AuthProvider;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface EligibilityRecord {
  id: string;
  voter_identity_id: string;
  provider: AuthProvider;
  status: EligibilityStatus;
  account_created_at: string | null;
  calculated_age_days: number | null;
  evidence_note: string | null;
  evidence_url: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoteRecord {
  id: string;
  awards_year_id: string;
  category_id: string;
  nominee_id: string;
  voter_id: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryResult {
  id: string;
  awards_year_id: string;
  category_id: string;
  nominee_id: string;
  position: number;
  vote_count: number;
  vote_percentage: number;
  points_awarded: number;
  is_tie: boolean;
  tiebreak_note: string | null;
  finalized_at: string;
  nominee?: Nominee;
}

export interface PlayerAward {
  id: string;
  awards_year_id: string;
  player_id: string;
  category_id: string;
  nominee_id: string;
  source_type: 'individual' | 'team_member';
  position: number;
  points_earned: number;
  category?: Category;
  nominee?: Nominee;
}

export interface OverallRanking {
  id: string;
  awards_year_id: string;
  player_id: string;
  rank_position: number;
  total_points: number;
  categories_won: number;
  podium_finishes: number;
  updated_at: string;
  player?: Player;
  awards?: PlayerAward[];
}

export interface AdministratorRole {
  id: string;
  auth_user_id: string | null;
  email: string;
  role: AdminRoleType;
  is_active: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface PublicBootstrapPayload {
  supabaseConfigured: boolean;
  years: AwardsYear[];
  selectedYear: AwardsYear | null;
  categories: Category[];
  nominees: Nominee[];
  resultsPublished: boolean;
  categoryResults: CategoryResult[] | null;
  overallRankings: OverallRanking[] | null;
}

export interface VoterSessionState {
  voter: VoterIdentity | null;
  eligibilities: EligibilityRecord[];
  emailVerified: boolean;
  overallEligible: boolean;
  eligibilitySummary: string;
  votes: VoteRecord[];
  isAdmin: boolean;
  adminRole: AdminRoleType | null;
}
