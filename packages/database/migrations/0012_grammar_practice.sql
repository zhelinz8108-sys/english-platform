CREATE TABLE grammar_practice_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learner_membership_id uuid NOT NULL,
  topic_id varchar(120) NOT NULL,
  level varchar(20) NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  content_version varchar(80) NOT NULL,
  question_ids jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  question_count smallint NOT NULL DEFAULT 10 CHECK (question_count = 10),
  correct_count smallint CHECK (correct_count BETWEEN 0 AND question_count),
  accuracy smallint CHECK (accuracy BETWEEN 0 AND 100),
  mastered boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, learner_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(question_ids) = 'array' AND jsonb_array_length(question_ids) = 10),
  CHECK (jsonb_typeof(answers) = 'object'),
  CHECK (
    (status = 'active' AND completed_at IS NULL AND correct_count IS NULL AND accuracy IS NULL)
    OR
    (status = 'completed' AND completed_at IS NOT NULL AND correct_count IS NOT NULL AND accuracy IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_grammar_practice_active_stage
  ON grammar_practice_sessions (tenant_id, learner_membership_id, topic_id, level)
  WHERE status = 'active';

CREATE INDEX idx_grammar_practice_learner_progress
  ON grammar_practice_sessions (
    tenant_id,
    learner_membership_id,
    topic_id,
    level,
    completed_at DESC
  );

CREATE TRIGGER trg_grammar_practice_updated_at
  BEFORE UPDATE ON grammar_practice_sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE grammar_practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_practice_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON grammar_practice_sessions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON grammar_practice_sessions TO english_app, english_worker;
