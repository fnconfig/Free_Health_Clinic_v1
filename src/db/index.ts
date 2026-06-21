/**
 * Database connection — Supabase (PostgreSQL via pg Pool + Drizzle ORM)
 *
 * Fixes vs original:
 *  - Consistent env variable names (SQL_USER, not SQL_ADMIN_USER which was
 *    inconsistent with drizzle.config.ts that used SQL_ADMIN_USER)
 *  - DATABASE_URL is the recommended Supabase connection string
 *  - Added max pool size for Supabase's connection limits
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";
import * as dotenv from "dotenv";

// Load environment variables immediately on import to prevent ordering issues
dotenv.config();

function buildPool(): Pool {
  // Prefer the full DATABASE_URL (Supabase gives you this in project settings)
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    });
  }

  // Fall back to individual credentials
  const required = ["SQL_HOST", "SQL_USER", "SQL_PASSWORD", "SQL_DB_NAME"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Set DATABASE_URL or all four SQL_* variables in your .env file."
    );
  }

  return new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    port: process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432,
    ssl: process.env.SQL_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
  });
}

export const pool = buildPool();

// Prevent unhandled errors from crashing the process
pool.on("error", (err) => {
  console.error("[DB] Unexpected idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
