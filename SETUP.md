# Setup Guide — Klinik Kesehatan GPIB Bukit Zaitun

## What was fixed in this version

| Area | Problem | Fix |
|------|---------|-----|
| **Google OAuth** | Used Firebase SDK (deprecated approach, requires Firebase project) | Replaced with **Google Identity Services (GIS)** — no Firebase needed |
| **DB Schema** | `users.uid` referenced Firebase UID; `serial` PK instead of UUID; no `authorized_roles` table | UUID primary keys, `google_sub` column, `authorized_roles` table for RBAC |
| **DB Connection** | Env variable inconsistency: `SQL_ADMIN_USER` in config vs `SQL_USER` in pool | Unified to `SQL_USER` / `SQL_PASSWORD` throughout |
| **Auth endpoint** | `/api/auth/sync` accepted mock UIDs without verification | `/api/auth/google` verifies the real GIS ID-token with Google's tokeninfo API |
| **RLS** | No Supabase Row-Level Security policies | `supabase/migrations/001_initial_schema.sql` adds full RLS |
| **Role access** | DOCTOR/ADMIN allow-list stored in `localStorage` (insecure) | `authorized_roles` table in Supabase |

---

## Quick Start

### 1. Google Cloud Console
1. Go to https://console.cloud.google.com/apis/credentials
2. Create → **OAuth 2.0 Client ID** → Web application
3. Authorised JavaScript origins: `http://localhost:3000`
4. Copy the **Client ID**

### 2. Supabase
1. Create a project at https://supabase.com
2. Go to **Project Settings → Database → Connection string → URI**
3. Copy the `DATABASE_URL`
4. Run the migration in **SQL Editor**: paste contents of `supabase/migrations/001_initial_schema.sql`

### 3. Environment Variables
```bash
cp .env.example .env
# Edit .env with your real values:
#   DATABASE_URL=postgresql://...
#   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
#   VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com   # same value!
#   MASTER_ADMIN_EMAIL=your@gmail.com
#   GEMINI_API_KEY=AIza...  (optional)
```

### 4. Install & Run
```bash
npm install
npm run db:push      # push schema to Supabase
npm run dev          # starts Express + Vite on port 3000
```

---

## Auth Flow (GIS)

```
Browser                     Server                      Google
  │                            │                           │
  │── click "Login" ──────────>│                           │
  │                            │                           │
  │<─ GIS One-Tap prompt ──────│ (loaded from CDN)         │
  │── user picks account ─────>│                           │
  │                            │                           │
  │      GIS returns ID-token (JWT signed by Google)       │
  │                            │                           │
  │── POST /api/auth/google ──>│                           │
  │   { idToken, role }        │── GET tokeninfo?id_token >│
  │                            │<─ { sub, email, name } ───│
  │                            │                           │
  │                            │── upsert users table      │
  │                            │── check authorized_roles  │
  │<─ { accessGranted: true } ─│                           │
  │                            │                           │
  │   setCurrentRole(role)     │                           │
```

---

## Adding a Doctor or Admin

Run in Supabase SQL Editor:
```sql
INSERT INTO public.authorized_roles (email, role, granted_by)
VALUES ('newdoctor@example.com', 'DOCTOR', 'your@gmail.com');
```

Or the Master Admin email (set in `.env`) always has full access.
