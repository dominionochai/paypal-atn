import type { Database } from 'better-sqlite3';

export interface AppliedSettings {
  journal_mode: string;
  foreign_keys: number;
  synchronous: number;
  busy_timeout: number;
  trusted_schema: number;
  temp_store: number;
}

function readSetting<K extends keyof AppliedSettings>(
  db: Database,
  setting: K,
): AppliedSettings[K] {
  const value: unknown = db.pragma(setting, { simple: true });
  return value as AppliedSettings[K];
}

export function hardenDatabase(db: Database): AppliedSettings {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.pragma('trusted_schema = OFF');
  db.pragma('temp_store = MEMORY');

  const applied: AppliedSettings = {
    journal_mode: readSetting(db, 'journal_mode'),
    foreign_keys: readSetting(db, 'foreign_keys'),
    synchronous: readSetting(db, 'synchronous'),
    busy_timeout: readSetting(db, 'busy_timeout'),
    trusted_schema: readSetting(db, 'trusted_schema'),
    temp_store: readSetting(db, 'temp_store'),
  };

  if (applied.foreign_keys !== 1) {
    throw new Error('database hardening failed: foreign_keys did not apply');
  }
  if (applied.trusted_schema !== 0) {
    throw new Error('database hardening failed: trusted_schema did not apply');
  }

  return applied;
}
