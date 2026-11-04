-- ATN schema, migration 009 (N1+N2: channels inside vaults, settlement correctness).

-- Add vault_id, reservation_ref, delegation_id to channels
ALTER TABLE channels ADD COLUMN vault_id TEXT REFERENCES vaults(id);
ALTER TABLE channels ADD COLUMN reservation_ref TEXT;
ALTER TABLE channels ADD COLUMN delegation_id INTEGER REFERENCES delegations(id);

-- Add status constraint for SETTLED if not exists (should already exist from 002_streaming.sql)
-- ALTER TABLE channels ADD COLUMN status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SETTLED', 'EXPIRED', 'CLOSED'));

-- Settlement tracking table - add status column if it doesn't exist
-- The 002_streaming.sql created settlements without status, so we add it
ALTER TABLE settlements ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));

-- Add completed_at column if not exists
ALTER TABLE settlements ADD COLUMN completed_at TEXT;

-- Create index if not exists
CREATE INDEX IF NOT EXISTS idx_settlements_channel ON settlements(channel_id);

-- Update vaults to ensure funding_ref_hash is NOT NULL (already done in 008)
-- No further changes needed for vaults