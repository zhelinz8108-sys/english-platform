CREATE TABLE toefl_listening_assets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  file_object_id uuid NOT NULL,
  collection_slug varchar(120) NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  title varchar(300) NOT NULL,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, collection_slug, sequence_no),
  FOREIGN KEY (tenant_id, file_object_id)
    REFERENCES file_objects(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_toefl_listening_assets_collection
  ON toefl_listening_assets (tenant_id, collection_slug, sequence_no);

ALTER TABLE toefl_listening_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE toefl_listening_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON toefl_listening_assets
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

GRANT SELECT ON toefl_listening_assets TO english_app, english_worker;
