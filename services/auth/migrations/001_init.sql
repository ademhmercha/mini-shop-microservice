CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  shipping_address jsonb,
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset', 'change_email')),
  token_hash text NOT NULL UNIQUE,
  new_email text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz
);
CREATE INDEX backup_codes_user ON backup_codes (user_id);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid,
  event text NOT NULL,
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user ON audit_log (user_id, created_at);

-- Moindre privilège : l'utilisateur applicatif ne modifie pas le schéma
-- et ne peut ni modifier ni supprimer le journal d'audit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON users, email_tokens, sessions, refresh_tokens, backup_codes TO auth_app;
    GRANT SELECT, INSERT ON audit_log TO auth_app;
    GRANT USAGE ON SEQUENCE audit_log_id_seq TO auth_app;
  END IF;
END $$;
