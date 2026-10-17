ALTER TABLE api_keys ADD COLUMN expires_at timestamptz;
ALTER TABLE api_keys ADD COLUMN replaces_key_id uuid UNIQUE REFERENCES api_keys(id);
