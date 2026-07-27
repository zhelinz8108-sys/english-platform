ALTER TABLE users
  ADD COLUMN login_name citext,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz;

CREATE UNIQUE INDEX uq_users_login_name
  ON users(login_name)
  WHERE login_name IS NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_check;

ALTER TABLE users
  ADD CONSTRAINT users_identifier_required
  CHECK (
    email_normalized IS NOT NULL
    OR phone_e164 IS NOT NULL
    OR login_name IS NOT NULL
  );
