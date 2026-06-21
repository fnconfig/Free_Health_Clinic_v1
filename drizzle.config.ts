/**
 * Drizzle Kit configuration — placed at project ROOT so `drizzle-kit push`
 * finds it automatically without needing a --config flag.
 *
 * Run:
 *   npm run db:push      → push schema directly to Supabase
 *   npm run db:generate  → generate SQL migration files
 *
 * Required .env variables:
 *   DATABASE_URL   (full Supabase connection string — recommended)
 *   or
 *   SQL_HOST / SQL_USER / SQL_PASSWORD / SQL_DB_NAME
 */

import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config(); // loads .env from project root

const databaseUrl = process.env.DATABASE_URL;
const sqlHost     = process.env.SQL_HOST;
const sqlDbName   = process.env.SQL_DB_NAME;
const sqlUser     = process.env.SQL_USER;
const sqlPassword = process.env.SQL_PASSWORD;
const sqlPort     = process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432;

if (!databaseUrl && (!sqlHost || !sqlDbName || !sqlUser || !sqlPassword)) {
  throw new Error(
    "Missing database config. Set DATABASE_URL (or SQL_HOST + SQL_USER + SQL_PASSWORD + SQL_DB_NAME) in your .env file."
  );
}

export default defineConfig({
  schema:        "./src/db/schema.ts",   // path relative to project root
  out:           "./drizzle",            // where migration SQL files go
  dialect:       "postgresql",
  schemaFilter:  ["public"],
  dbCredentials: databaseUrl
    ? {
        url: databaseUrl,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host:     sqlHost!,
        user:     sqlUser!,
        password: sqlPassword!,
        database: sqlDbName!,
        port:     sqlPort,
        ssl:      false,
      },
  verbose: true,
});
