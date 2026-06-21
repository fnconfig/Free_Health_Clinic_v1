-- ============================================================
-- Klinik Kesehatan GPIB Bukit Zaitun — Supabase Migration 001
-- Initial schema setup with Row-Level Security (RLS) policies.
--
-- Run in Supabase SQL Editor or via:
--   supabase db push
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  photo_url    TEXT,
  role         TEXT NOT NULL DEFAULT 'PATIENT'
                  CHECK (role IN ('PATIENT', 'DOCTOR', 'ADMIN')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_google_sub_idx ON public.users (google_sub);
CREATE INDEX IF NOT EXISTS users_email_idx      ON public.users (email);

-- ── authorized_roles ─────────────────────────────────────────
-- Stores which emails are pre-authorized for DOCTOR / ADMIN access.
CREATE TABLE IF NOT EXISTS public.authorized_roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('DOCTOR', 'ADMIN')),
  granted_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, role)
);
CREATE INDEX IF NOT EXISTS authorized_roles_email_role_idx
  ON public.authorized_roles (email, role);

-- Seed default admin (replace with real values)
INSERT INTO public.authorized_roles (email, role, granted_by)
VALUES
  ('admin@gpibbukitzaitun.org',    'ADMIN',  'fritssigerdkayadoe@gmail.com'),
  ('dr.sarah@gpibbukitzaitun.org', 'DOCTOR', 'fritssigerdkayadoe@gmail.com')
ON CONFLICT DO NOTHING;

-- ── patients ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patients (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  email                  TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  birth_date             TEXT NOT NULL,
  preferred_language     TEXT NOT NULL,
  faith_support_requested BOOLEAN NOT NULL DEFAULT FALSE,
  faith_notes            TEXT,
  insurance_notes        TEXT NOT NULL DEFAULT '',
  medical_history        JSONB NOT NULL DEFAULT '[]',
  allergies              JSONB NOT NULL DEFAULT '[]',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── appointments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointments (
  id                  TEXT PRIMARY KEY,
  patient_id          TEXT NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  patient_name        TEXT NOT NULL,
  date                TEXT NOT NULL,
  time_slot           TEXT NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING_TRIAGE'
                        CHECK (status IN ('PENDING_TRIAGE', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  urgency             TEXT NOT NULL DEFAULT 'ROUTINE'
                        CHECK (urgency IN ('ROUTINE', 'SOON', 'URGENT')),
  triage_summary      TEXT NOT NULL DEFAULT '',
  triage_chat_history JSONB NOT NULL DEFAULT '[]',
  triage_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  suggested_follow_up JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TEXT NOT NULL DEFAULT ''
);

-- ── prescriptions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id               TEXT PRIMARY KEY,
  patient_id       TEXT NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  date_prescribed  TEXT NOT NULL,
  medication_name  TEXT NOT NULL,
  dosage           TEXT NOT NULL,
  frequency        TEXT NOT NULL,
  instructions     TEXT NOT NULL,
  doctor_name      TEXT NOT NULL,
  refills_left     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── audit_logs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id           TEXT PRIMARY KEY,
  timestamp    TEXT NOT NULL,
  actor_email  TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT ''
);

-- ============================================================
-- Row-Level Security (RLS)
-- The server-side Express API runs with the service_role key
-- (bypasses RLS), so these policies protect direct client access.
-- ============================================================

ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorized_roles ENABLE ROW LEVEL SECURITY;

-- Allow the service_role (server) to do anything
CREATE POLICY "service_role_all_users"      ON public.users            FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_patients"   ON public.patients         FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_appts"      ON public.appointments     FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_rx"         ON public.prescriptions    FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_logs"       ON public.audit_logs       FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_auth_roles" ON public.authorized_roles FOR ALL TO service_role USING (true);

-- Disallow anonymous (public) reads — all access goes through the Express API
-- (authenticated with GOOGLE_CLIENT_ID token verification)
REVOKE ALL ON public.users            FROM anon, authenticated;
REVOKE ALL ON public.patients         FROM anon, authenticated;
REVOKE ALL ON public.appointments     FROM anon, authenticated;
REVOKE ALL ON public.prescriptions    FROM anon, authenticated;
REVOKE ALL ON public.audit_logs       FROM anon, authenticated;
REVOKE ALL ON public.authorized_roles FROM anon, authenticated;
