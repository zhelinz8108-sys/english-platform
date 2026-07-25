ALTER TABLE toefl_listening_assets
  ADD COLUMN source_id varchar(220),
  ADD COLUMN published_at char(8)
    CHECK (published_at IS NULL OR published_at ~ '^[0-9]{8}$');

UPDATE toefl_listening_assets
SET source_id = CASE
  WHEN collection_slug = 'minute-earth'
    THEN 'minute-earth-' || lpad(sequence_no::text, 3, '0')
  ELSE collection_slug || '-' || lpad(sequence_no::text, 3, '0')
END
WHERE source_id IS NULL;

ALTER TABLE toefl_listening_assets
  ALTER COLUMN source_id SET NOT NULL;

ALTER TABLE toefl_listening_assets
  ADD CONSTRAINT uq_toefl_listening_assets_source
  UNIQUE (tenant_id, source_id);

CREATE TABLE toefl_listening_question_sets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  listening_asset_id uuid NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  label varchar(200) NOT NULL CHECK (length(btrim(label)) > 0),
  exact_simulation boolean NOT NULL,
  review_status varchar(30) NOT NULL
    CHECK (review_status IN ('reviewed', 'adjudicated', 'approved')),
  questions jsonb NOT NULL
    CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) = 4),
  skill_version varchar(30) NOT NULL,
  content_generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, listening_asset_id),
  FOREIGN KEY (tenant_id, listening_asset_id)
    REFERENCES toefl_listening_assets(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_toefl_listening_question_sets_asset
  ON toefl_listening_question_sets (tenant_id, listening_asset_id);

ALTER TABLE toefl_listening_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE toefl_listening_question_sets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON toefl_listening_question_sets
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

GRANT SELECT ON toefl_listening_question_sets TO english_app, english_worker;
