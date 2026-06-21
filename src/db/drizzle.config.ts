/**
 * Drizzle Kit configuration — Supabase (PostgreSQL)
 *
 * Run migrations:  npm run db:push
 * Generate SQL:    npm run db:generate
 *
 * Env variables (set in .env):
 *   DATABASE_URL          — full Supabase connection string (recommended)
 *   or
 *   SQL_HOST / SQL_USER / SQL_PASSWORD / SQL_DB_NAME / SQL_PORT
 */

import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
const sqlHost     = process.env.SQL_HOST;
const sqlDbName   = process.env.SQL_DB_NAME;
const sqlUser     = process.env.SQL_USER;        // Fixed: was SQL_ADMIN_USER in original
const sqlPassword = process.env.SQL_PASSWORD;    // Fixed: was SQL_ADMIN_PASSWORD in original
const sqlPort     = process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432;

if (!databaseUrl && (!sqlHost || !sqlDbName || !sqlUser || !sqlPassword)) {
  throw new Error(
    "Set DATABASE_URL or all of SQL_HOST, SQL_DB_NAME, SQL_USER, SQL_PASSWORD in your .env file."
  );
}

export default defineConfig({
  schema: "./schema.ts",
  out: "../../drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: databaseUrl
    ? {
        url: databaseUrl,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: sqlHost!,
        user: sqlUser!,
        password: sqlPassword!,
        database: sqlDbName!,
        port: sqlPort,
        ssl: false,
      },
  verbose: true,
});
