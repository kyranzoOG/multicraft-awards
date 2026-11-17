-- ============================================================================
-- MultiCraft Awards — Complete Supabase PostgreSQL Schema, RLS & Storage Setup
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. AWARDS YEARS
CREATE TABLE IF NOT EXISTS public.awards_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_label INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  voting_starts_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'voting_active', 'voting_closed', 'results_published', 'archived')),
  tie_policy TEXT NOT NULL DEFAULT 'shared_rank'
    CHECK (tie_policy IN ('shared_rank', 'earliest_vote', 'admin_tiebreak')),
  allow_vote_editing BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_awards_years_active ON public.awards_years (is_active);
CREATE INDEX IF NOT EXISTS idx_awards_years_status ON public.awards_years (status);

-- 2. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_url TEXT,
  icon_name TEXT DEFAULT 'Trophy',
  display_order INTEGER NOT NULL DEFAULT 0,
  winning_positions_count INTEGER NOT NULL DEFAULT 3 CHECK (winning_positions_count >= 1 AND winning_positions_count <= 50),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_team_category BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (awards_year_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_year_order ON public.categories (awards_year_id, display_order);

-- 3. CATEGORY POINT RULES
CREATE TABLE IF NOT EXISTS public.category_point_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, position)
);

CREATE INDEX IF NOT EXISTS idx_point_rules_category ON public.category_point_rules (category_id, position);

-- 4. PLAYERS (Persistent individual player identity across categories & years)
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  unique_slug TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  skin_url TEXT,
  skin_model TEXT NOT NULL DEFAULT 'classic' CHECK (skin_model IN ('classic', 'slim')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_name ON public.players (player_name);

-- 5. TEAMS (For Duo / Team nominees)
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  unique_slug TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  description TEXT DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TEAM MEMBERS (Links registered individual players to a Duo / Team)
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  role_label TEXT DEFAULT 'Member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_player ON public.team_members (player_id);

-- 7. NOMINEES
CREATE TABLE IF NOT EXISTS public.nominees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  nominee_type TEXT NOT NULL DEFAULT 'player' CHECK (nominee_type IN ('player', 'team')),
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  profile_image_url TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  skin_url TEXT,
  skin_model TEXT NOT NULL DEFAULT 'classic' CHECK (skin_model IN ('classic', 'slim')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (nominee_type = 'player' AND player_id IS NOT NULL AND team_id IS NULL) OR
    (nominee_type = 'team' AND team_id IS NOT NULL AND player_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_nominees_year_cat ON public.nominees (awards_year_id, category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nominees_unique_player_cat ON public.nominees (awards_year_id, category_id, player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nominees_unique_team_cat ON public.nominees (awards_year_id, category_id, team_id) WHERE team_id IS NOT NULL;

-- 8. VOTER IDENTITIES (Immutable provider IDs + linked Google & Discord accounts)
CREATE TABLE IF NOT EXISTS public.voter_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE,
  google_provider_id TEXT UNIQUE,
  google_email TEXT,
  google_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  discord_provider_id TEXT UNIQUE,
  discord_username TEXT,
  discord_email TEXT,
  discord_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  discord_created_at TIMESTAMPTZ,
  primary_provider TEXT NOT NULL CHECK (primary_provider IN ('google', 'discord')),
  display_name TEXT NOT NULL DEFAULT 'Community Voter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voter_auth_user ON public.voter_identities (auth_user_id);

-- 9. AUTHENTICATION VERIFICATIONS (Email OTP & provider verification audit)
CREATE TABLE IF NOT EXISTS public.authentication_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_identity_id UUID NOT NULL REFERENCES public.voter_identities(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL CHECK (verification_type IN ('google_oauth', 'discord_oauth', 'gmail_otp', 'discord_email_otp')),
  email_address TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_verifications_voter ON public.authentication_verifications (voter_identity_id);

-- 10. ELIGIBILITY RECORDS (30-Day Account Age Verification)
CREATE TABLE IF NOT EXISTS public.eligibility_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_identity_id UUID NOT NULL REFERENCES public.voter_identities(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'discord')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ineligible')),
  account_created_at TIMESTAMPTZ,
  calculated_age_days INTEGER,
  evidence_note TEXT,
  evidence_url TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voter_identity_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_eligibility_status ON public.eligibility_records (status);

-- 11. VOTES (Strict duplicate protection per year + category + voter)
CREATE TABLE IF NOT EXISTS public.votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  nominee_id UUID NOT NULL REFERENCES public.nominees(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES public.voter_identities(id) ON DELETE CASCADE,
  device_fingerprint_hash TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_vote_per_year_category_voter UNIQUE (awards_year_id, category_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_year_cat ON public.votes (awards_year_id, category_id);
CREATE INDEX IF NOT EXISTS idx_votes_nominee ON public.votes (nominee_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON public.votes (voter_id);

-- 12. CATEGORY RESULTS (Private until year.status = 'results_published')
CREATE TABLE IF NOT EXISTS public.category_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  nominee_id UUID NOT NULL REFERENCES public.nominees(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  vote_count INTEGER NOT NULL DEFAULT 0,
  vote_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  is_tie BOOLEAN NOT NULL DEFAULT FALSE,
  tiebreak_note TEXT,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (awards_year_id, category_id, nominee_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_results_year_cat ON public.category_results (awards_year_id, category_id, position);

-- 13. PLAYER AWARDS (Individual point attribution including full team points per member)
CREATE TABLE IF NOT EXISTS public.player_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  nominee_id UUID NOT NULL REFERENCES public.nominees(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('individual', 'team_member')),
  position INTEGER NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (awards_year_id, player_id, category_id, nominee_id)
);

CREATE INDEX IF NOT EXISTS idx_player_awards_year_player ON public.player_awards (awards_year_id, player_id);

-- 14. OVERALL RANKINGS (Overall MultiCraft Player of the Year Leaderboard)
CREATE TABLE IF NOT EXISTS public.overall_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awards_year_id UUID NOT NULL REFERENCES public.awards_years(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  rank_position INTEGER NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  categories_won INTEGER NOT NULL DEFAULT 0,
  podium_finishes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (awards_year_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_overall_rankings_year ON public.overall_rankings (awards_year_id, rank_position);

-- 15. ADMINISTRATOR ROLES
CREATE TABLE IF NOT EXISTS public.administrator_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'awards_admin' CHECK (role IN ('super_admin', 'awards_admin', 'moderator')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

-- 17. WEBSITE SETTINGS
CREATE TABLE IF NOT EXISTS public.website_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- ============================================================================
-- HELPER FUNCTION FOR ADMIN CHECKS IN RLS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.administrator_roles
    WHERE is_active = TRUE
      AND (
        auth_user_id = uid
        OR (
          email IS NOT NULL
          AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.awards_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nominees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voter_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authentication_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eligibility_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overall_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administrator_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;

-- Public read access for non-sensitive catalog data
CREATE POLICY "Public read awards_years" ON public.awards_years FOR SELECT USING (true);
CREATE POLICY "Public read enabled categories" ON public.categories FOR SELECT USING (is_enabled = true OR public.is_admin(auth.uid()));
CREATE POLICY "Public read category_point_rules" ON public.category_point_rules FOR SELECT USING (true);
CREATE POLICY "Public read players" ON public.players FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Public read team_members" ON public.team_members FOR SELECT USING (true);
CREATE POLICY "Public read active nominees" ON public.nominees FOR SELECT USING (is_active = true OR public.is_admin(auth.uid()));
CREATE POLICY "Public read website_settings" ON public.website_settings FOR SELECT USING (true);

-- Results & Rankings: STRICTLY HIDDEN unless awards_year status is 'results_published' (or admin)
CREATE POLICY "Published read category_results" ON public.category_results
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.awards_years y
      WHERE y.id = category_results.awards_year_id AND y.status = 'results_published'
    )
  );

CREATE POLICY "Published read player_awards" ON public.player_awards
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.awards_years y
      WHERE y.id = player_awards.awards_year_id AND y.status = 'results_published'
    )
  );

CREATE POLICY "Published read overall_rankings" ON public.overall_rankings
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.awards_years y
      WHERE y.id = overall_rankings.awards_year_id AND y.status = 'results_published'
    )
  );

-- Voter identities, verifications, eligibility: own row or admin
CREATE POLICY "Own voter_identities read" ON public.voter_identities
  FOR SELECT USING (auth.uid() = auth_user_id OR public.is_admin(auth.uid()));

CREATE POLICY "Own voter_identities insert" ON public.voter_identities
  FOR INSERT WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Own voter_identities update" ON public.voter_identities
  FOR UPDATE USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Own authentication_verifications read" ON public.authentication_verifications
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.voter_identities v
      WHERE v.id = authentication_verifications.voter_identity_id AND v.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Own eligibility_records read" ON public.eligibility_records
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.voter_identities v
      WHERE v.id = eligibility_records.voter_identity_id AND v.auth_user_id = auth.uid()
    )
  );

-- Votes: own votes readable & writable by verified voter during active voting
CREATE POLICY "Own votes read" ON public.votes
  FOR SELECT USING (
    public.is_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.voter_identities v
      WHERE v.id = votes.voter_id AND v.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Verified own votes insert" ON public.votes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.voter_identities v
      WHERE v.id = votes.voter_id
        AND v.auth_user_id = auth.uid()
        AND v.google_email_verified = TRUE
    )
    AND EXISTS (
      SELECT 1 FROM public.awards_years y
      WHERE y.id = votes.awards_year_id AND y.status = 'voting_active'
    )
  );

CREATE POLICY "Verified own votes update" ON public.votes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.voter_identities v
      WHERE v.id = votes.voter_id
        AND v.auth_user_id = auth.uid()
        AND v.google_email_verified = TRUE
    )
    AND EXISTS (
      SELECT 1 FROM public.awards_years y
      WHERE y.id = votes.awards_year_id
        AND y.status = 'voting_active'
        AND y.allow_vote_editing = TRUE
    )
  );

-- Admin-only tables
CREATE POLICY "Admin read administrator_roles" ON public.administrator_roles
  FOR SELECT USING (
    public.is_admin(auth.uid())
    OR auth.uid() = auth_user_id
    OR (email IS NOT NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );

CREATE POLICY "Admin read audit_logs" ON public.audit_logs
  FOR SELECT USING (public.is_admin(auth.uid()));

CREATE POLICY "Admin write audit_logs" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- Admin write policies across management tables
CREATE POLICY "Admin manage awards_years" ON public.awards_years FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage categories" ON public.categories FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage category_point_rules" ON public.category_point_rules FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage players" ON public.players FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage teams" ON public.teams FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage team_members" ON public.team_members FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage nominees" ON public.nominees FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage eligibility_records" ON public.eligibility_records FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage category_results" ON public.category_results FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage player_awards" ON public.player_awards FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage overall_rankings" ON public.overall_rankings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage administrator_roles" ON public.administrator_roles FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admin manage website_settings" ON public.website_settings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- STORAGE BUCKETS FOR 3D SKINS, AVATARS, AND CATEGORY ICONS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('player-skins', 'player-skins', true),
  ('category-icons', 'category-icons', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read storage player-skins" ON storage.objects FOR SELECT USING (bucket_id IN ('player-skins', 'category-icons', 'avatars'));
CREATE POLICY "Admin write storage" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('player-skins', 'category-icons', 'avatars') AND public.is_admin(auth.uid()));
CREATE POLICY "Admin update storage" ON storage.objects FOR UPDATE USING (bucket_id IN ('player-skins', 'category-icons', 'avatars') AND public.is_admin(auth.uid()));
CREATE POLICY "Admin delete storage" ON storage.objects FOR DELETE USING (bucket_id IN ('player-skins', 'category-icons', 'avatars') AND public.is_admin(auth.uid()));

-- ============================================================================
-- INITIAL SEED: CURRENT AWARDS YEAR & 9 DEFAULT CATEGORIES (NO FAKE USERS/VOTES)
-- ============================================================================
DO $$
DECLARE
  v_year_id UUID;
  v_cat_id UUID;
BEGIN
  INSERT INTO public.awards_years (year_label, title, description, status, tie_policy, is_active)
  VALUES (
    2026,
    'MultiCraft Awards 2026',
    'Annual honors celebrating builders, creators, PvP competitors, bluestoners, and teams in the MultiCraft Build and Mine community.',
    'voting_active',
    'shared_rank',
    TRUE
  )
  ON CONFLICT (year_label) DO UPDATE SET year_label = EXCLUDED.year_label
  RETURNING id INTO v_year_id;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE awards_year_id = v_year_id) THEN
    -- 1. Best Editor (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-editor', 'Best Editor', 'Recognizing cinematic pacing, visual storytelling, and sound design in MultiCraft video edits.', 'Film', 1, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 2. Best Streamer (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-streamer', 'Best Streamer', 'Honoring live broadcast consistency, community engagement, and entertaining MultiCraft streams.', 'Radio', 2, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 3. Best Mobile Content Creator (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-mobile-content-creator', 'Best Mobile Content Creator', 'Celebrating standout MultiCraft creators producing, editing, and playing natively on mobile.', 'Smartphone', 3, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 4. Best Builder (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-builder', 'Best Builder', 'Awarded for architectural scale, terrain mastery, block palette artistry, and worldcraft.', 'Blocks', 4, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 5. Best PvPer (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-pvper', 'Best PvPer', 'Honoring mechanical precision, combat awareness, and competitive arena dominance.', 'Swords', 5, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 6. Best Duo / Team (3 positions, team category)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-duo-team', 'Best Duo / Team', 'Celebrating synchronized partnerships and collaborative squads across MultiCraft.', 'Users', 6, 3, TRUE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 7. Best YouTuber (10 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-youtuber', 'Best YouTuber', 'Recognizing the top long-form MultiCraft video creators shaping the community.', 'Youtube', 7, 10, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES
      (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3),
      (v_cat_id, 4, 0), (v_cat_id, 5, 0), (v_cat_id, 6, 0), (v_cat_id, 7, 0),
      (v_cat_id, 8, 0), (v_cat_id, 9, 0), (v_cat_id, 10, 0);

    -- 8. Best FPV Player (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-fpv-player', 'Best FPV Player', 'Honoring first-person movement mastery, precision parkour, and aerial gameplay.', 'Crosshair', 8, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);

    -- 9. Best Bluestoner (3 positions)
    INSERT INTO public.categories (awards_year_id, slug, name, description, icon_name, display_order, winning_positions_count, is_team_category)
    VALUES (v_year_id, 'best-bluestoner', 'Best Bluestoner', 'Awarded for ingenious MultiCraft Bluestone circuitry, automation, and mechanical contraptions.', 'Cpu', 9, 3, FALSE)
    RETURNING id INTO v_cat_id;
    INSERT INTO public.category_point_rules (category_id, position, points) VALUES (v_cat_id, 1, 5), (v_cat_id, 2, 2), (v_cat_id, 3, 3);
  END IF;
END $$;
