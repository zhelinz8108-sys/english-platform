CREATE TABLE vocabulary_assessment_items (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  item_key varchar(160) NOT NULL,
  band smallint NOT NULL CHECK (band BETWEEN 1 AND 14),
  target_word varchar(120) NOT NULL CHECK (length(btrim(target_word)) > 0),
  sentence text NOT NULL CHECK (length(btrim(sentence)) > 0),
  options jsonb NOT NULL CHECK (
    jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
  ),
  correct_option_index smallint NOT NULL CHECK (correct_option_index BETWEEN 0 AND 3),
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'pilot', 'active', 'retired')),
  content_version varchar(80) NOT NULL,
  source_list_version varchar(80) NOT NULL,
  review_notes text,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, item_key, content_version),
  FOREIGN KEY (tenant_id, reviewed_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('active', 'pilot', 'retired')) = (reviewed_at IS NOT NULL))
);

CREATE INDEX idx_vocabulary_assessment_items_selection
  ON vocabulary_assessment_items (tenant_id, status, content_version, band, id);

CREATE TABLE vocabulary_assessment_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learner_membership_id uuid NOT NULL,
  mode varchar(16) NOT NULL CHECK (mode IN ('quick', 'standard')),
  target_track varchar(32) NOT NULL DEFAULT 'general'
    CHECK (target_track IN ('general', 'toefl')),
  status varchar(16) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'active', 'paused', 'scoring', 'completed', 'abandoned', 'invalid')),
  stage varchar(16) NOT NULL DEFAULT 'routing'
    CHECK (stage IN ('routing', 'precision')),
  content_version varchar(80) NOT NULL,
  algorithm_version varchar(80) NOT NULL,
  calibration_version varchar(80) NOT NULL,
  interpretation_version varchar(80) NOT NULL,
  source_list_version varchar(80) NOT NULL,
  routing_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(routing_item_ids) = 'array'),
  answered_count integer NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  rapid_response_count integer NOT NULL DEFAULT 0 CHECK (rapid_response_count >= 0),
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, learner_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_vocabulary_assessment_sessions_learner
  ON vocabulary_assessment_sessions (tenant_id, learner_membership_id, created_at DESC);
CREATE UNIQUE INDEX uq_vocabulary_assessment_active_session
  ON vocabulary_assessment_sessions (tenant_id, learner_membership_id)
  WHERE status IN ('created', 'active', 'paused', 'scoring');

CREATE TABLE vocabulary_assessment_deliveries (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  item_id uuid NOT NULL,
  stage varchar(16) NOT NULL CHECK (stage IN ('routing', 'precision')),
  position integer NOT NULL CHECK (position >= 1),
  option_order jsonb NOT NULL CHECK (
    jsonb_typeof(option_order) = 'array' AND jsonb_array_length(option_order) = 4
  ),
  delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, position),
  UNIQUE (tenant_id, session_id, item_id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES vocabulary_assessment_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES vocabulary_assessment_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_vocabulary_assessment_deliveries_session
  ON vocabulary_assessment_deliveries (tenant_id, session_id, position);

CREATE TABLE vocabulary_assessment_responses (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  selected_option_position smallint CHECK (selected_option_position BETWEEN 0 AND 3),
  was_unknown boolean NOT NULL DEFAULT false,
  is_correct boolean NOT NULL,
  response_time_ms integer NOT NULL CHECK (response_time_ms BETWEEN 0 AND 120000),
  idempotency_key varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_id),
  UNIQUE (tenant_id, session_id, idempotency_key),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES vocabulary_assessment_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES vocabulary_assessment_deliveries(tenant_id, id) ON DELETE RESTRICT,
  CHECK (was_unknown = (selected_option_position IS NULL))
);

CREATE INDEX idx_vocabulary_assessment_responses_session
  ON vocabulary_assessment_responses (tenant_id, session_id, created_at);

CREATE TABLE vocabulary_assessment_results (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  learner_membership_id uuid NOT NULL,
  estimate integer NOT NULL CHECK (estimate BETWEEN 0 AND 14000),
  interval_lower integer NOT NULL CHECK (interval_lower BETWEEN 0 AND 14000),
  interval_upper integer NOT NULL CHECK (interval_upper BETWEEN 0 AND 14000),
  confidence numeric(4,3) NOT NULL DEFAULT 0.950 CHECK (confidence > 0 AND confidence < 1),
  reliability varchar(16) NOT NULL CHECK (reliability IN ('HIGH', 'MEDIUM', 'LOW', 'INVALID')),
  band_profile jsonb NOT NULL CHECK (jsonb_typeof(band_profile) = 'array'),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  content_version varchar(80) NOT NULL,
  algorithm_version varchar(80) NOT NULL,
  calibration_version varchar(80) NOT NULL,
  interpretation_version varchar(80) NOT NULL,
  source_list_version varchar(80) NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES vocabulary_assessment_sessions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, learner_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (interval_lower <= estimate AND estimate <= interval_upper)
);

CREATE INDEX idx_vocabulary_assessment_results_learner
  ON vocabulary_assessment_results (tenant_id, learner_membership_id, completed_at DESC);

ALTER TABLE vocabulary_assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_items FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_results FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vocabulary_assessment_items
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_sessions
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_deliveries
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_responses
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_results
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

GRANT SELECT ON vocabulary_assessment_items TO english_app, english_worker;
GRANT INSERT, SELECT, UPDATE ON vocabulary_assessment_sessions TO english_app, english_worker;
GRANT INSERT, SELECT, UPDATE ON vocabulary_assessment_deliveries TO english_app, english_worker;
GRANT INSERT, SELECT ON vocabulary_assessment_responses TO english_app, english_worker;
GRANT INSERT, SELECT ON vocabulary_assessment_results TO english_app, english_worker;
