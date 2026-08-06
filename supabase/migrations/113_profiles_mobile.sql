-- Adds mobile phone field to profiles, alongside existing phone (office/desk).
-- Needed for the email signature template, which shows both P: and M: lines.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mobile text;
