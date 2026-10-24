/**
 * Database bootstrap: opening connections and applying migrations.
 * Migrations in ./migrations/*.sql are the single source of truth for the
 * schema. The migration runner tracks applied files in the `_migrations`
 * table and is idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";

export type Database = BetterSqlite3.Database;

const UTC_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Open a SQLite database with safe defaults. Does not run migrations. */
export function openDatabase(filename: string): Database {
  const db = new BetterSqlite3(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  return db;
}

function resolveMigrationsDir(): string {
  const candidates = [
    new URL("./migrations", import.meta.url),
    new URL("../../src/db/migrations", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const dir = fileURLToPath(candidate);
      if (fs.existsSync(dir)) {
        return dir;
      }
    } catch {
      // ignore and try the next candidate
    }
  }
  throw new Error("unable to locate db/migrations directory");
}

/**
 * Apply every pending migration in `migrationsDir` (defaults to the bundled
 * ./migrations). Each migration runs inside its own transaction and is
 * recorded in `_migrations`; applying twice is a no-op.
 */
export function runMigrations(db: Database, migrationsDir?: string): void {
  const dir = migrationsDir ?? resolveMigrationsDir();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (${UTC_NOW})
    )
  `);

  const appliedRows = db
    .prepare("SELECT filename FROM _migrations")
    .all() as ReadonlyArray<{ readonly filename: string }>;
  const applied = new Set(appliedRows.map((row) => row.filename));

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
    });
    apply();
  }
}

/** Open a database and migrate it to the latest schema in one step. */
export function createDatabase(filename: string, migrationsDir?: string): Database {
  const db = openDatabase(filename);
  runMigrations(db, migrationsDir);
  return db;
}