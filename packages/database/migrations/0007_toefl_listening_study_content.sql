CREATE TABLE toefl_listening_study_contents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  listening_asset_id uuid NOT NULL,
  transcript text NOT NULL CHECK (length(btrim(transcript)) > 0),
  transcript_word_count integer NOT NULL CHECK (transcript_word_count > 0),
  vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(vocabulary) = 'array'),
  source_file_name varchar(500) NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, listening_asset_id),
  FOREIGN KEY (tenant_id, listening_asset_id)
    REFERENCES toefl_listening_assets(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_toefl_listening_study_contents_asset
  ON toefl_listening_study_contents (tenant_id, listening_asset_id);

ALTER TABLE toefl_listening_study_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE toefl_listening_study_contents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON toefl_listening_study_contents
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

GRANT SELECT ON toefl_listening_study_contents TO english_app, english_worker;
