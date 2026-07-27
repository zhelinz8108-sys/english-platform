CREATE TABLE self_study_attempts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learner_membership_id uuid NOT NULL,
  module varchar(20) NOT NULL
    CHECK (module IN ('vocabulary', 'grammar', 'listening', 'reading')),
  activity_type varchar(30) NOT NULL
    CHECK (activity_type IN ('study', 'practice', 'assessment')),
  content_key varchar(240) NOT NULL,
  content_title varchar(240) NOT NULL,
  client_event_id varchar(120) NOT NULL,
  question_count integer CHECK (question_count IS NULL OR question_count >= 0),
  correct_count integer CHECK (correct_count IS NULL OR correct_count >= 0),
  score_percent numeric(5,2) CHECK (
    score_percent IS NULL OR (score_percent >= 0 AND score_percent <= 100)
  ),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, learner_membership_id, client_event_id),
  FOREIGN KEY (tenant_id, learner_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    correct_count IS NULL
    OR question_count IS NULL
    OR correct_count <= question_count
  )
);

CREATE INDEX idx_self_study_attempts_learner
  ON self_study_attempts (
    tenant_id,
    learner_membership_id,
    completed_at DESC
  );

CREATE INDEX idx_self_study_attempts_module
  ON self_study_attempts (
    tenant_id,
    learner_membership_id,
    module,
    completed_at DESC
  );

ALTER TABLE self_study_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_study_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON self_study_attempts
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT ON self_study_attempts TO english_app, english_worker;
