CREATE TABLE task_assignments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_version_id uuid NOT NULL,
  source_type assignment_source NOT NULL,
  occurrence_key varchar(180) NOT NULL,
  slot_key varchar(180) NOT NULL,
  explicit_priority smallint NOT NULL DEFAULT 0 CHECK (explicit_priority BETWEEN 0 AND 99),
  schedule_mode assignment_schedule_mode NOT NULL,
  available_at timestamptz,
  due_at timestamptz,
  close_at timestamptz,
  max_attempts smallint NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 20),
  late_policy late_policy NOT NULL DEFAULT 'deny',
  status assignment_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  cancelled_at timestamptz,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, task_version_id),
  UNIQUE (tenant_id, id, source_type),
  FOREIGN KEY (tenant_id, task_version_id)
    REFERENCES task_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (schedule_mode = 'absolute' AND available_at IS NOT NULL)
    OR (schedule_mode = 'path_relative' AND available_at IS NULL AND due_at IS NULL AND close_at IS NULL)
  ),
  CHECK (due_at IS NULL OR available_at IS NULL OR due_at >= available_at),
  CHECK (close_at IS NULL OR close_at >= COALESCE(due_at, available_at)),
  CHECK (status = 'draft' OR published_at IS NOT NULL),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE TABLE task_assignment_student_targets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_assignment_id uuid NOT NULL,
  student_profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, student_profile_id),
  UNIQUE (tenant_id, task_assignment_id, student_profile_id),
  FOREIGN KEY (tenant_id, task_assignment_id)
    REFERENCES task_assignments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE task_assignment_class_targets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_assignment_id uuid NOT NULL,
  class_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, class_id),
  UNIQUE (tenant_id, task_assignment_id, class_id),
  FOREIGN KEY (tenant_id, task_assignment_id)
    REFERENCES task_assignments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, class_id)
    REFERENCES classes(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE task_assignment_path_targets (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_assignment_id uuid NOT NULL,
  path_node_id uuid NOT NULL,
  learning_path_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, learning_path_version_id),
  UNIQUE (tenant_id, task_assignment_id, path_node_id),
  FOREIGN KEY (tenant_id, task_assignment_id)
    REFERENCES task_assignments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, learning_path_version_id, path_node_id)
    REFERENCES path_nodes(tenant_id, learning_path_version_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION app.protect_and_validate_assignment()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  student_count integer;
  class_count integer;
  path_count integer;
  invalid_path_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published assignment cannot be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'cancelled') THEN
    IF NOT (
      OLD.status = 'published'
      AND NEW.status = 'cancelled'
      AND (to_jsonb(NEW) - ARRAY['status', 'cancelled_at', 'updated_at'])
          = (to_jsonb(OLD) - ARRAY['status', 'cancelled_at', 'updated_at'])
    ) THEN
      RAISE EXCEPTION 'published assignment is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    SELECT count(*) INTO student_count
      FROM task_assignment_student_targets
      WHERE tenant_id = NEW.tenant_id AND task_assignment_id = NEW.id;
    SELECT count(*) INTO class_count
      FROM task_assignment_class_targets
      WHERE tenant_id = NEW.tenant_id AND task_assignment_id = NEW.id;
    SELECT count(*) INTO path_count
      FROM task_assignment_path_targets
      WHERE tenant_id = NEW.tenant_id AND task_assignment_id = NEW.id;

    IF (CASE WHEN student_count > 0 THEN 1 ELSE 0 END)
       + (CASE WHEN class_count > 0 THEN 1 ELSE 0 END)
       + (CASE WHEN path_count > 0 THEN 1 ELSE 0 END) <> 1 THEN
      RAISE EXCEPTION 'assignment must use exactly one target table' USING ERRCODE = '23514';
    END IF;

    IF NEW.source_type = 'individual' AND student_count = 0
      OR NEW.source_type = 'class' AND class_count = 0
      OR NEW.source_type IN ('general', 'exam_path') AND path_count = 0 THEN
      RAISE EXCEPTION 'assignment source and target type mismatch' USING ERRCODE = '23514';
    END IF;

    IF path_count > 0 THEN
      SELECT count(*) INTO invalid_path_count
      FROM task_assignment_path_targets target
      JOIN path_nodes node
        ON node.tenant_id = target.tenant_id AND node.id = target.path_node_id
      JOIN learning_path_versions version
        ON version.tenant_id = node.tenant_id AND version.id = node.learning_path_version_id
      JOIN learning_paths path
        ON path.tenant_id = version.tenant_id AND path.id = version.learning_path_id
      WHERE target.tenant_id = NEW.tenant_id
        AND target.task_assignment_id = NEW.id
        AND (
          node.task_version_id <> NEW.task_version_id
          OR (NEW.source_type = 'general' AND path.track <> 'general')
          OR (NEW.source_type = 'exam_path' AND path.track <> 'toefl')
        );
      IF invalid_path_count > 0 THEN
        RAISE EXCEPTION 'path target is inconsistent with assignment' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.protect_assignment_target()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  row_data jsonb;
  assignment_status_value text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT status::text INTO assignment_status_value
  FROM task_assignments
  WHERE tenant_id = (row_data ->> 'tenant_id')::uuid
    AND id = (row_data ->> 'task_assignment_id')::uuid;
  IF assignment_status_value <> 'draft' THEN
    RAISE EXCEPTION 'published assignment targets are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE TRIGGER trg_assignment_protect
  BEFORE UPDATE OR DELETE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION app.protect_and_validate_assignment();
CREATE TRIGGER trg_student_targets_protect
  BEFORE INSERT OR UPDATE OR DELETE ON task_assignment_student_targets
  FOR EACH ROW EXECUTE FUNCTION app.protect_assignment_target();
CREATE TRIGGER trg_class_targets_protect
  BEFORE INSERT OR UPDATE OR DELETE ON task_assignment_class_targets
  FOR EACH ROW EXECUTE FUNCTION app.protect_assignment_target();
CREATE TRIGGER trg_path_targets_protect
  BEFORE INSERT OR UPDATE OR DELETE ON task_assignment_path_targets
  FOR EACH ROW EXECUTE FUNCTION app.protect_assignment_target();

CREATE TABLE student_task_items (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_profile_id uuid NOT NULL,
  task_version_id uuid NOT NULL,
  occurrence_key varchar(180) NOT NULL,
  slot_key varchar(180) NOT NULL,
  winning_source_id uuid,
  resolution_state resolution_state NOT NULL DEFAULT 'active',
  resolution_reason resolution_reason NOT NULL DEFAULT 'winner',
  workflow_state workflow_state NOT NULL DEFAULT 'not_started',
  available_at timestamptz NOT NULL,
  due_at timestamptz,
  close_at timestamptz,
  resolution_revision bigint NOT NULL DEFAULT 1 CHECK (resolution_revision >= 1),
  resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, student_profile_id),
  UNIQUE (tenant_id, student_profile_id, task_version_id, occurrence_key),
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, task_version_id)
    REFERENCES task_versions(tenant_id, id) ON DELETE RESTRICT,
  CHECK (due_at IS NULL OR due_at >= available_at),
  CHECK (close_at IS NULL OR close_at >= COALESCE(due_at, available_at))
);

CREATE UNIQUE INDEX uq_active_student_slot
  ON student_task_items(tenant_id, student_profile_id, slot_key)
  WHERE resolution_state = 'active';
CREATE INDEX ix_student_task_list
  ON student_task_items(
    tenant_id, student_profile_id, resolution_state, workflow_state, due_at, id
  );

CREATE TABLE student_task_sources (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_task_item_id uuid NOT NULL,
  student_profile_id uuid NOT NULL,
  task_assignment_id uuid NOT NULL,
  student_target_id uuid,
  class_target_id uuid,
  path_target_id uuid,
  class_id uuid,
  learning_path_version_id uuid,
  class_student_id uuid,
  student_path_enrollment_id uuid,
  source_type assignment_source NOT NULL,
  source_weight smallint NOT NULL,
  explicit_priority smallint NOT NULL CHECK (explicit_priority BETWEEN 0 AND 99),
  published_at timestamptz NOT NULL,
  occurrence_key varchar(180) NOT NULL,
  slot_key varchar(180) NOT NULL,
  available_at timestamptz NOT NULL,
  due_at timestamptz,
  close_at timestamptz,
  inactive_at timestamptz,
  inactive_reason source_inactive_reason,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, student_task_item_id),
  FOREIGN KEY (tenant_id, student_task_item_id, student_profile_id)
    REFERENCES student_task_items(tenant_id, id, student_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, task_assignment_id, source_type)
    REFERENCES task_assignments(tenant_id, id, source_type) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_target_id, student_profile_id)
    REFERENCES task_assignment_student_targets(tenant_id, id, student_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, class_target_id, class_id)
    REFERENCES task_assignment_class_targets(tenant_id, id, class_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, class_student_id, class_id, student_profile_id)
    REFERENCES class_students(tenant_id, id, class_id, student_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, path_target_id, learning_path_version_id)
    REFERENCES task_assignment_path_targets(tenant_id, id, learning_path_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, student_path_enrollment_id, learning_path_version_id, student_profile_id
  ) REFERENCES student_path_enrollments(
    tenant_id, id, learning_path_version_id, student_profile_id
  ) ON DELETE RESTRICT,
  CHECK (
    (student_target_id IS NOT NULL AND class_target_id IS NULL AND path_target_id IS NULL
      AND class_id IS NULL AND class_student_id IS NULL
      AND learning_path_version_id IS NULL AND student_path_enrollment_id IS NULL)
    OR
    (student_target_id IS NULL AND class_target_id IS NOT NULL AND path_target_id IS NULL
      AND class_id IS NOT NULL AND class_student_id IS NOT NULL
      AND learning_path_version_id IS NULL AND student_path_enrollment_id IS NULL)
    OR
    (student_target_id IS NULL AND class_target_id IS NULL AND path_target_id IS NOT NULL
      AND class_id IS NULL AND class_student_id IS NULL
      AND learning_path_version_id IS NOT NULL AND student_path_enrollment_id IS NOT NULL)
  ),
  CHECK (
    source_weight = CASE source_type
      WHEN 'admin_forced' THEN 500
      WHEN 'individual' THEN 400
      WHEN 'class' THEN 300
      WHEN 'exam_path' THEN 200
      WHEN 'general' THEN 100
    END
  ),
  CHECK ((inactive_at IS NULL) = (inactive_reason IS NULL)),
  CHECK (due_at IS NULL OR due_at >= available_at),
  CHECK (close_at IS NULL OR close_at >= COALESCE(due_at, available_at))
);

CREATE UNIQUE INDEX uq_student_source_direct
  ON student_task_sources(tenant_id, student_task_item_id, student_target_id)
  WHERE student_target_id IS NOT NULL;
CREATE UNIQUE INDEX uq_student_source_class
  ON student_task_sources(tenant_id, student_task_item_id, class_target_id, class_student_id)
  WHERE class_target_id IS NOT NULL;
CREATE UNIQUE INDEX uq_student_source_path
  ON student_task_sources(
    tenant_id, student_task_item_id, path_target_id, student_path_enrollment_id
  ) WHERE path_target_id IS NOT NULL;
CREATE INDEX ix_student_source_winner
  ON student_task_sources(
    tenant_id, student_task_item_id, inactive_at, source_weight DESC,
    explicit_priority DESC, published_at DESC, id DESC
  );

ALTER TABLE student_task_items
  ADD CONSTRAINT fk_student_task_items_winning_source
  FOREIGN KEY (tenant_id, winning_source_id, id)
  REFERENCES student_task_sources(tenant_id, id, student_task_item_id) ON DELETE RESTRICT;

CREATE TABLE student_task_overrides (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_task_item_id uuid NOT NULL,
  action override_action NOT NULL,
  replacement_task_version_id uuid,
  available_at timestamptz,
  due_at timestamptz,
  close_at timestamptz,
  reverses_override_id uuid,
  reason varchar(500) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, student_task_item_id),
  FOREIGN KEY (tenant_id, student_task_item_id)
    REFERENCES student_task_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, replacement_task_version_id)
    REFERENCES task_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reverses_override_id, student_task_item_id)
    REFERENCES student_task_overrides(tenant_id, id, student_task_item_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((action = 'replace') = (replacement_task_version_id IS NOT NULL)),
  CHECK ((action = 'restore') = (reverses_override_id IS NOT NULL)),
  CHECK (
    action <> 'reschedule'
    OR available_at IS NOT NULL OR due_at IS NOT NULL OR close_at IS NOT NULL
  )
);

CREATE INDEX ix_student_overrides_replay
  ON student_task_overrides(tenant_id, student_task_item_id, created_at, id);

CREATE TABLE task_attempts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_task_item_id uuid NOT NULL,
  attempt_no smallint NOT NULL CHECK (attempt_no >= 1),
  state attempt_state NOT NULL DEFAULT 'in_progress',
  snapshot_hash char(64) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_submitted_at timestamptz,
  completed_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, student_task_item_id, attempt_no),
  FOREIGN KEY (tenant_id, student_task_item_id)
    REFERENCES student_task_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_open_attempt
  ON task_attempts(tenant_id, student_task_item_id)
  WHERE state IN ('in_progress', 'submitted', 'grading', 'returned');
CREATE INDEX ix_task_attempts_latest
  ON task_attempts(tenant_id, student_task_item_id, attempt_no DESC);

CREATE OR REPLACE FUNCTION app.validate_attempt_insert()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  previous_attempt_no integer;
  allowed_attempts integer;
BEGIN
  IF NEW.state <> 'in_progress' THEN
    RAISE EXCEPTION 'new attempt must start in_progress' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM student_task_items
  WHERE tenant_id = NEW.tenant_id AND id = NEW.student_task_item_id
  FOR UPDATE;

  SELECT COALESCE(max(attempt_no), 0) INTO previous_attempt_no
  FROM task_attempts
  WHERE tenant_id = NEW.tenant_id AND student_task_item_id = NEW.student_task_item_id;

  SELECT assignment.max_attempts INTO allowed_attempts
  FROM student_task_items item
  JOIN student_task_sources source
    ON source.tenant_id = item.tenant_id AND source.id = item.winning_source_id
  JOIN task_assignments assignment
    ON assignment.tenant_id = source.tenant_id AND assignment.id = source.task_assignment_id
  WHERE item.tenant_id = NEW.tenant_id AND item.id = NEW.student_task_item_id;

  IF allowed_attempts IS NULL THEN
    RAISE EXCEPTION 'task item has no active assignment policy' USING ERRCODE = '23514';
  END IF;
  IF NEW.attempt_no <> previous_attempt_no + 1 THEN
    RAISE EXCEPTION 'attempt_no must be consecutive' USING ERRCODE = '23514';
  END IF;
  IF NEW.attempt_no > allowed_attempts THEN
    RAISE EXCEPTION 'max_attempts exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_attempt_insert_validate
  BEFORE INSERT ON task_attempts
  FOR EACH ROW EXECUTE FUNCTION app.validate_attempt_insert();

CREATE TABLE attempt_item_snapshots (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_attempt_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  content_version_item_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  prompt_snapshot jsonb NOT NULL,
  options_snapshot jsonb,
  option_order jsonb,
  answer_key_snapshot jsonb,
  scoring_rule_snapshot jsonb NOT NULL,
  max_score numeric(8,2) NOT NULL CHECK (max_score > 0),
  snapshot_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_attempt_id, position),
  FOREIGN KEY (tenant_id, task_attempt_id)
    REFERENCES task_attempts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, content_version_item_id)
    REFERENCES content_version_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, question_version_id)
    REFERENCES question_versions(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE attempt_drafts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_attempt_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  etag char(64) NOT NULL,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_attempt_id),
  UNIQUE (tenant_id, task_attempt_id, etag),
  FOREIGN KEY (tenant_id, task_attempt_id)
    REFERENCES task_attempts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE submission_snapshots (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_attempt_id uuid NOT NULL,
  submission_revision integer NOT NULL CHECK (submission_revision >= 1),
  previous_submission_snapshot_id uuid,
  draft_revision bigint NOT NULL CHECK (draft_revision >= 1),
  responses jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  client_submitted_at timestamptz,
  is_late boolean NOT NULL,
  snapshot_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, task_attempt_id),
  UNIQUE (tenant_id, task_attempt_id, submission_revision),
  UNIQUE (tenant_id, task_attempt_id, draft_revision),
  FOREIGN KEY (tenant_id, task_attempt_id)
    REFERENCES task_attempts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, previous_submission_snapshot_id, task_attempt_id)
    REFERENCES submission_snapshots(tenant_id, id, task_attempt_id) ON DELETE RESTRICT,
  CHECK (
    (submission_revision = 1 AND previous_submission_snapshot_id IS NULL)
    OR (submission_revision > 1 AND previous_submission_snapshot_id IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION app.validate_submission_revision()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  previous_revision integer;
  previous_id uuid;
  current_draft_revision bigint;
  current_attempt_state attempt_state;
BEGIN
  SELECT state INTO current_attempt_state
  FROM task_attempts
  WHERE tenant_id = NEW.tenant_id AND id = NEW.task_attempt_id
  FOR UPDATE;

  IF current_attempt_state <> 'in_progress' THEN
    RAISE EXCEPTION 'only an in_progress attempt can be submitted' USING ERRCODE = '23514';
  END IF;

  SELECT revision INTO current_draft_revision
  FROM attempt_drafts
  WHERE tenant_id = NEW.tenant_id AND task_attempt_id = NEW.task_attempt_id;
  IF current_draft_revision IS NULL OR NEW.draft_revision <> current_draft_revision THEN
    RAISE EXCEPTION 'submission draft revision is stale' USING ERRCODE = '40001';
  END IF;

  SELECT submission_revision, id INTO previous_revision, previous_id
  FROM submission_snapshots
  WHERE tenant_id = NEW.tenant_id AND task_attempt_id = NEW.task_attempt_id
  ORDER BY submission_revision DESC
  LIMIT 1;

  IF previous_revision IS NULL THEN
    IF NEW.submission_revision <> 1 OR NEW.previous_submission_snapshot_id IS NOT NULL THEN
      RAISE EXCEPTION 'first submission revision is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.submission_revision <> previous_revision + 1
      OR NEW.previous_submission_snapshot_id IS DISTINCT FROM previous_id THEN
    RAISE EXCEPTION 'submission revision chain is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_submission_revision_validate
  BEFORE INSERT ON submission_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.validate_submission_revision();

CREATE TABLE score_decisions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_attempt_id uuid NOT NULL,
  submission_snapshot_id uuid NOT NULL,
  decision_type score_decision_type NOT NULL,
  score numeric(8,2) NOT NULL,
  max_score numeric(8,2) NOT NULL CHECK (max_score > 0),
  component_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  rubric_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  supersedes_score_decision_id uuid,
  decided_by_membership_id uuid,
  reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, submission_snapshot_id),
  FOREIGN KEY (tenant_id, task_attempt_id)
    REFERENCES task_attempts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, submission_snapshot_id, task_attempt_id)
    REFERENCES submission_snapshots(tenant_id, id, task_attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_score_decision_id, submission_snapshot_id)
    REFERENCES score_decisions(tenant_id, id, submission_snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, decided_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (score >= 0 AND score <= max_score),
  CHECK (
    (decision_type = 'auto_scored' AND decided_by_membership_id IS NULL)
    OR (decision_type <> 'auto_scored' AND decided_by_membership_id IS NOT NULL)
  ),
  CHECK (decision_type <> 'admin_override' OR reason IS NOT NULL)
);

CREATE INDEX ix_score_decisions_effective
  ON score_decisions(
    tenant_id, submission_snapshot_id, decision_type, created_at DESC, id DESC
  );

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_attempt_id uuid NOT NULL,
  submission_snapshot_id uuid NOT NULL,
  score_decision_id uuid,
  feedback_type feedback_type NOT NULL,
  visibility feedback_visibility NOT NULL DEFAULT 'student',
  body jsonb NOT NULL,
  supersedes_feedback_id uuid,
  authored_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, submission_snapshot_id),
  FOREIGN KEY (tenant_id, task_attempt_id)
    REFERENCES task_attempts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, submission_snapshot_id, task_attempt_id)
    REFERENCES submission_snapshots(tenant_id, id, task_attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, score_decision_id, submission_snapshot_id)
    REFERENCES score_decisions(tenant_id, id, submission_snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_feedback_id, submission_snapshot_id)
    REFERENCES feedback(tenant_id, id, submission_snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, authored_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (feedback_type = 'system' AND authored_by_membership_id IS NULL)
    OR (feedback_type <> 'system' AND authored_by_membership_id IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION app.require_latest_submission()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  latest_submission_id uuid;
BEGIN
  SELECT id INTO latest_submission_id
  FROM submission_snapshots
  WHERE tenant_id = NEW.tenant_id AND task_attempt_id = NEW.task_attempt_id
  ORDER BY submission_revision DESC
  LIMIT 1;
  IF latest_submission_id IS DISTINCT FROM NEW.submission_snapshot_id THEN
    RAISE EXCEPTION 'decision must target latest submission revision' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_score_latest_submission
  BEFORE INSERT ON score_decisions
  FOR EACH ROW EXECUTE FUNCTION app.require_latest_submission();
CREATE TRIGGER trg_feedback_latest_submission
  BEFORE INSERT ON feedback
  FOR EACH ROW EXECUTE FUNCTION app.require_latest_submission();

CREATE VIEW effective_score_decisions WITH (security_invoker = true) AS
WITH latest_submission AS (
  SELECT DISTINCT ON (tenant_id, task_attempt_id)
    tenant_id, task_attempt_id, id AS submission_snapshot_id
  FROM submission_snapshots
  ORDER BY tenant_id, task_attempt_id, submission_revision DESC
),
unsuperseded AS (
  SELECT decision.*
  FROM score_decisions decision
  LEFT JOIN score_decisions newer
    ON newer.tenant_id = decision.tenant_id
   AND newer.supersedes_score_decision_id = decision.id
   AND newer.submission_snapshot_id = decision.submission_snapshot_id
  WHERE newer.id IS NULL
)
SELECT DISTINCT ON (decision.tenant_id, decision.task_attempt_id)
  decision.*
FROM latest_submission submission
JOIN unsuperseded decision
  ON decision.tenant_id = submission.tenant_id
 AND decision.task_attempt_id = submission.task_attempt_id
 AND decision.submission_snapshot_id = submission.submission_snapshot_id
ORDER BY
  decision.tenant_id,
  decision.task_attempt_id,
  CASE decision.decision_type
    WHEN 'admin_override' THEN 300
    WHEN 'teacher_confirmed' THEN 200
    WHEN 'auto_scored' THEN 100
  END DESC,
  decision.created_at DESC,
  decision.id DESC;

CREATE TABLE file_objects (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  storage_key varchar(512) NOT NULL,
  category file_category NOT NULL,
  media_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  status file_status NOT NULL DEFAULT 'pending',
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storage_key),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_version_files (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  content_version_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  usage varchar(80) NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, content_version_id, file_object_id, usage),
  FOREIGN KEY (tenant_id, content_version_id)
    REFERENCES content_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_object_id)
    REFERENCES file_objects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE question_version_files (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  question_version_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  usage varchar(80) NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, question_version_id, file_object_id, usage),
  FOREIGN KEY (tenant_id, question_version_id)
    REFERENCES question_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_object_id)
    REFERENCES file_objects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE feedback_files (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  feedback_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  usage varchar(80) NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, feedback_id, file_object_id, usage),
  FOREIGN KEY (tenant_id, feedback_id)
    REFERENCES feedback(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_object_id)
    REFERENCES file_objects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_content_version_files_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON content_version_files
  FOR EACH ROW EXECUTE FUNCTION app.protect_child_of_published(
    'content_versions', 'content_version_id'
  );
CREATE TRIGGER trg_question_version_files_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON question_version_files
  FOR EACH ROW EXECUTE FUNCTION app.protect_child_of_published(
    'question_versions', 'question_version_id'
  );

CREATE TABLE progress_projections (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_profile_id uuid NOT NULL,
  projection_type projection_type NOT NULL,
  projection_key varchar(160) NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_cursor uuid NOT NULL,
  as_of timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, student_profile_id, projection_type, projection_key),
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_by text,
  locked_at timestamptz,
  published_at timestamptz,
  last_error_code varchar(120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX ix_outbox_claim
  ON outbox_events(available_at, created_at, id) WHERE status = 'pending';

CREATE TABLE worker_event_receipts (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  consumer_name varchar(120) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id, consumer_name),
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES outbox_events(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  operation varchar(120) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  status idempotency_status NOT NULL DEFAULT 'in_progress',
  response_status smallint CHECK (response_status BETWEEN 100 AND 599),
  response_headers jsonb,
  response_body jsonb,
  locked_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id, operation, idempotency_key),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);

CREATE INDEX ix_idempotency_expiry ON idempotency_records(expires_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_membership_id uuid,
  actor_type audit_actor_type NOT NULL,
  action varchar(120) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid,
  before_hash char(64),
  after_hash char(64),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  ip_hash char(64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (actor_type = 'worker' AND actor_membership_id IS NULL)
    OR actor_type <> 'worker'
  )
);

CREATE INDEX ix_audit_resource
  ON audit_logs(tenant_id, resource_type, resource_id, created_at DESC, id DESC);
CREATE INDEX ix_audit_request ON audit_logs(tenant_id, request_id);

CREATE OR REPLACE FUNCTION app.reject_update_or_delete()
RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER trg_overrides_append_only
  BEFORE UPDATE OR DELETE ON student_task_overrides
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_attempt_snapshots_append_only
  BEFORE UPDATE OR DELETE ON attempt_item_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_submissions_append_only
  BEFORE UPDATE OR DELETE ON submission_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_scores_append_only
  BEFORE UPDATE OR DELETE ON score_decisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_feedback_append_only
  BEFORE UPDATE OR DELETE ON feedback
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_worker_receipts_append_only
  BEFORE UPDATE OR DELETE ON worker_event_receipts
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_update_or_delete();

CREATE TRIGGER trg_assignments_updated_at BEFORE UPDATE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_student_items_updated_at BEFORE UPDATE ON student_task_items
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_attempts_updated_at BEFORE UPDATE ON task_attempts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_attempt_drafts_updated_at BEFORE UPDATE ON attempt_drafts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_files_updated_at BEFORE UPDATE ON file_objects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_idempotency_updated_at BEFORE UPDATE ON idempotency_records
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_progress_updated_at BEFORE UPDATE ON progress_projections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'membership_roles', 'membership_role_assignments',
    'student_profiles', 'teacher_profiles', 'student_teacher_links',
    'classes', 'class_teachers', 'class_students', 'student_exam_goals',
    'contents', 'content_versions', 'questions', 'question_versions', 'content_version_items',
    'tasks', 'task_versions', 'learning_paths', 'learning_path_versions',
    'path_nodes', 'path_prerequisites', 'student_path_enrollments',
    'task_assignments', 'task_assignment_student_targets',
    'task_assignment_class_targets', 'task_assignment_path_targets',
    'student_task_items', 'student_task_sources', 'student_task_overrides',
    'task_attempts', 'attempt_item_snapshots', 'attempt_drafts', 'submission_snapshots',
    'score_decisions', 'feedback', 'file_objects', 'content_version_files',
    'question_version_files', 'feedback_files', 'progress_projections',
    'outbox_events', 'worker_event_receipts', 'idempotency_records', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
       USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
       WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal())',
      table_name
    );
  END LOOP;
END;
$rls$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_root_isolation ON tenants
  USING (id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenants_member_list ON tenants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM tenant_memberships membership
      WHERE membership.tenant_id = tenants.id
        AND membership.user_id = app.current_user_id()
        AND membership.status = 'active'
    )
  );

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_bootstrap_self ON tenant_memberships
  FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY membership_tenant_isolation ON tenant_memberships
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

CREATE POLICY role_assignments_self_list ON membership_role_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM tenant_memberships membership
      WHERE membership.tenant_id = membership_role_assignments.tenant_id
        AND membership.id = membership_role_assignments.membership_id
        AND membership.user_id = app.current_user_id()
        AND membership.status = 'active'
    )
  );

CREATE POLICY roles_self_list ON membership_roles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM membership_role_assignments assignment
      JOIN tenant_memberships membership
        ON membership.tenant_id = assignment.tenant_id
       AND membership.id = assignment.membership_id
      WHERE assignment.tenant_id = membership_roles.tenant_id
        AND assignment.role_id = membership_roles.id
        AND membership.user_id = app.current_user_id()
        AND membership.status = 'active'
    )
  );

CREATE OR REPLACE FUNCTION platform.claim_outbox_batch(worker_id text, batch_size integer)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  aggregate_id uuid,
  event_type text,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, platform
AS $function$
BEGIN
  IF worker_id IS NULL OR btrim(worker_id) = '' THEN
    RAISE EXCEPTION 'worker_id is required' USING ERRCODE = '22023';
  END IF;
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 500 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT event.id AS event_id
    FROM public.outbox_events event
    WHERE event.status = 'pending'
      AND event.available_at <= clock_timestamp()
    ORDER BY event.available_at, event.created_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  UPDATE public.outbox_events event
  SET status = 'processing',
      attempt_count = event.attempt_count + 1,
      locked_by = worker_id,
      locked_at = clock_timestamp()
  FROM candidates
  WHERE event.id = candidates.event_id
  RETURNING event.id, event.tenant_id, event.aggregate_id, event.event_type::text, event.payload;
END;
$function$;

REVOKE ALL ON FUNCTION platform.claim_outbox_batch(text, integer) FROM PUBLIC;
ALTER FUNCTION platform.claim_outbox_batch(text, integer) OWNER TO english_outbox_owner;
GRANT USAGE ON SCHEMA public TO english_outbox_owner;
GRANT SELECT, UPDATE ON outbox_events TO english_outbox_owner;
GRANT EXECUTE ON FUNCTION platform.claim_outbox_batch(text, integer) TO english_worker;

ALTER ROLE english_app NOBYPASSRLS;
ALTER ROLE english_worker NOBYPASSRLS;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app, platform TO english_app, english_worker;

GRANT SELECT ON
  platform.published_exams,
  platform.published_contents,
  platform.published_questions,
  platform.published_tasks,
  platform.published_learning_paths
TO english_app, english_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO english_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO english_worker;

REVOKE SELECT ON question_versions, attempt_item_snapshots FROM english_app;
GRANT SELECT (
  id, tenant_id, question_id, version_no, publication_state, prompt, options,
  scoring_rule, max_score, content_hash, source_platform_question_version_id,
  published_at, published_by_membership_id, created_at, updated_at
) ON question_versions TO english_app;
GRANT SELECT (
  id, tenant_id, task_attempt_id, position, content_version_item_id, question_version_id,
  prompt_snapshot, options_snapshot, option_order, scoring_rule_snapshot, max_score,
  snapshot_hash, created_at
) ON attempt_item_snapshots TO english_app;

GRANT SELECT, INSERT, UPDATE ON users, auth_sessions TO english_app;
GRANT DELETE ON auth_sessions TO english_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO english_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO english_worker;
