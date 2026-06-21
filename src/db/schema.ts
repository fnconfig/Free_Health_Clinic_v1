/**
 * Drizzle ORM schema — Supabase (PostgreSQL)
 *
 * Changes vs original:
 *  - users.id        → uuid (gen_random_uuid()) — matches Supabase auth.users
 *  - users.uid       → google_sub (stable Google subject identifier, NOT Firebase UID)
 *  - users.role      → added for row-level-security (RLS) policy enforcement
 *  - All tables      → snake_case column names (Supabase convention)
 *  - Proper NOT NULL constraints tightened
 *  - Index on users.google_sub and users.email for fast lookups
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// users — mirrors Supabase auth.users but lives in the public schema
//         so Drizzle/server can query it directly.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Stable Google OAuth subject (sub claim from ID-token).
     *  Replaces the old Firebase UID field. Nullable for email-only users. */
    googleSub: text("google_sub").unique(),

    email: text("email").notNull().unique(),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    photoUrl: text("photo_url"),

    /** Application-level role: PATIENT | DOCTOR | ADMIN */
    role: text("role").notNull().default("PATIENT"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    googleSubIdx: index("users_google_sub_idx").on(t.googleSub),
    emailIdx: index("users_email_idx").on(t.email),
  })
);

// ---------------------------------------------------------------------------
// patients
// ---------------------------------------------------------------------------
export const patients = pgTable("patients", {
  id: text("id").primaryKey(),            // pat-1, pat-2 …
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  birthDate: text("birth_date").notNull(),
  preferredLanguage: text("preferred_language").notNull(),
  faithSupportRequested: boolean("faith_support_requested").notNull().default(false),
  faithNotes: text("faith_notes"),
  insuranceNotes: text("insurance_notes").notNull().default(""),
  medicalHistory: jsonb("medical_history").notNull().$type<string[]>().default(sql`'[]'::jsonb`),
  allergies: jsonb("allergies").notNull().$type<string[]>().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// appointments
// ---------------------------------------------------------------------------
export const appointments = pgTable("appointments", {
  id: text("id").primaryKey(),            // appt-1, appt-2 …
  patientId: text("patient_id")
    .references(() => patients.id, { onDelete: "cascade" })
    .notNull(),
  patientName: text("patient_name").notNull(),
  date: text("date").notNull(),
  timeSlot: text("time_slot").notNull(),
  reason: text("reason").notNull(),

  /** Values: PENDING_TRIAGE | CONFIRMED | COMPLETED | CANCELLED */
  status: text("status").notNull().default("PENDING_TRIAGE"),

  /** Values: ROUTINE | SOON | URGENT */
  urgency: text("urgency").notNull().default("ROUTINE"),

  triageSummary: text("triage_summary").notNull().default(""),
  triageChatHistory: jsonb("triage_chat_history").notNull().$type<any[]>().default(sql`'[]'::jsonb`),
  triageCompleted: boolean("triage_completed").notNull().default(false),

  notes: text("notes"),
  suggestedFollowUp: jsonb("suggested_follow_up"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: text("updated_at").notNull().default(""),
});

// ---------------------------------------------------------------------------
// prescriptions
// ---------------------------------------------------------------------------
export const prescriptions = pgTable("prescriptions", {
  id: text("id").primaryKey(),            // rx-1, rx-2 …
  patientId: text("patient_id")
    .references(() => patients.id, { onDelete: "cascade" })
    .notNull(),
  datePrescribed: text("date_prescribed").notNull(),
  medicationName: text("medication_name").notNull(),
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(),
  instructions: text("instructions").notNull(),
  doctorName: text("doctor_name").notNull(),
  refillsLeft: integer("refills_left").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------
export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  actorEmail: text("actor_email").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
});

// ---------------------------------------------------------------------------
// authorized_roles — stores which emails are allowed to access DOCTOR/ADMIN roles
// (replaces the localStorage-based hack in the original code)
// ---------------------------------------------------------------------------
export const authorizedRoles = pgTable(
  "authorized_roles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    role: text("role").notNull(),   // DOCTOR | ADMIN
    grantedBy: text("granted_by"), // email of admin who granted access
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    emailRoleIdx: index("authorized_roles_email_role_idx").on(t.email, t.role),
  })
);

// ---------------------------------------------------------------------------
// Relations (ORM-level, for Drizzle's relational query API)
// ---------------------------------------------------------------------------
export const patientsRelations = relations(patients, ({ many }) => ({
  appointments: many(appointments),
  prescriptions: many(prescriptions),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
}));

export const prescriptionsRelations = relations(prescriptions, ({ one }) => ({
  patient: one(patients, {
    fields: [prescriptions.patientId],
    references: [patients.id],
  }),
}));
