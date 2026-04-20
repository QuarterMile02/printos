-- Add structured contact info fields to email_signatures.
-- The body column continues to hold the full rendered HTML.
-- These fields store the user-editable values separately so the
-- settings page can show a form instead of raw HTML.

ALTER TABLE email_signatures
  ADD COLUMN IF NOT EXISTS sig_full_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sig_title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sig_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sig_mobile text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sig_address text NOT NULL DEFAULT '';

-- Backfill Ruben's row with his known contact info
UPDATE email_signatures SET
  sig_full_name = 'Ruben Reyes',
  sig_title = 'President',
  sig_phone = '(956) 722-7690',
  sig_mobile = '(956) 236-4367',
  sig_address = '6420 Polaris Dr. Ste 4, Laredo, Texas 78041'
WHERE user_id = 'f86f2712-ebcd-4faa-bccb-0f0580bcfeae';
