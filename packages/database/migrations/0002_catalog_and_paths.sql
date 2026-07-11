CREATE OR REPLACE FUNCTION app.protect_published_version()
RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publication_state = 'published' THEN
    RAISE EXCEPTION 'published version is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publication_state = 'published' THEN
    RAISE EXCEPTION 'published version is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION app.protect_child_of_published()
RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE
  row_data jsonb;
  parent_id uuid;
  row_tenant_id uuid;
  parent_state text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  parent_id := (row_data ->> TG_ARGV[1])::uuid;
  row_tenant_id := (row_data ->> 'tenant_id')::uuid;
  EXECUTE format(
    'SELECT publication_state::text FROM public.%I WHERE tenant_id = $1 AND id = $2',
    TG_ARGV[0]
  ) INTO parent_state USING row_tenant_id, parent_id;
  IF parent_state = 'published' THEN
    RAISE EXCEPTION 'published version children are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE TABLE contents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind content_kind NOT NULL,
  slug varchar(120) NOT NULL,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  content_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  title varchar(240) NOT NULL,
  locale varchar(16) NOT NULL DEFAULT 'en',
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64),
  source_platform_content_version_id uuid
    REFERENCES platform.content_versions(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, content_id, version_no),
  FOREIGN KEY (tenant_id, content_id)
    REFERENCES contents(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    publication_state = 'draft'
    OR (content_hash IS NOT NULL AND published_at IS NOT NULL AND published_by_membership_id IS NOT NULL)
  )
);

ALTER TABLE contents
  ADD CONSTRAINT fk_contents_current_version
  FOREIGN KEY (tenant_id, current_published_version_id)
  REFERENCES content_versions(tenant_id, id) ON DELETE RESTRICT;

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind question_kind NOT NULL,
  slug varchar(120) NOT NULL,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE question_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  question_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  prompt jsonb NOT NULL,
  options jsonb,
  answer_key jsonb,
  scoring_rule jsonb NOT NULL,
  max_score numeric(8,2) NOT NULL CHECK (max_score > 0),
  content_hash char(64),
  source_platform_question_version_id uuid
    REFERENCES platform.question_versions(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, question_id, version_no),
  FOREIGN KEY (tenant_id, question_id)
    REFERENCES questions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    publication_state = 'draft'
    OR (content_hash IS NOT NULL AND published_at IS NOT NULL AND published_by_membership_id IS NOT NULL)
  )
);

ALTER TABLE questions
  ADD CONSTRAINT fk_questions_current_version
  FOREIGN KEY (tenant_id, current_published_version_id)
  REFERENCES question_versions(tenant_id, id) ON DELETE RESTRICT;

CREATE TABLE content_version_items (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  content_version_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  section_key varchar(80),
  position integer NOT NULL CHECK (position >= 0),
  points numeric(8,2) NOT NULL CHECK (points > 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, content_version_id, position),
  UNIQUE (tenant_id, content_version_id, question_version_id),
  FOREIGN KEY (tenant_id, content_version_id)
    REFERENCES content_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, question_version_id)
    REFERENCES question_versions(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  slug varchar(120) NOT NULL,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE task_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  task_kind task_kind NOT NULL,
  title varchar(240) NOT NULL,
  instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_version_id uuid NOT NULL,
  completion_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  grading_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_minutes smallint CHECK (estimated_minutes > 0),
  content_hash char(64),
  source_platform_task_version_id uuid
    REFERENCES platform.task_versions(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_id, version_no),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES tasks(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, content_version_id)
    REFERENCES content_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    publication_state = 'draft'
    OR (content_hash IS NOT NULL AND published_at IS NOT NULL AND published_by_membership_id IS NOT NULL)
  )
);

ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_current_version
  FOREIGN KEY (tenant_id, current_published_version_id)
  REFERENCES task_versions(tenant_id, id) ON DELETE RESTRICT;

CREATE TABLE learning_paths (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  slug varchar(120) NOT NULL,
  track learning_track NOT NULL,
  exam_id uuid REFERENCES platform.exams(id) ON DELETE RESTRICT,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((track = 'toefl') = (exam_id IS NOT NULL))
);

CREATE TABLE learning_path_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learning_path_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  title varchar(240) NOT NULL,
  description text,
  completion_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64),
  source_platform_learning_path_version_id uuid
    REFERENCES platform.learning_path_versions(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, learning_path_id, version_no),
  FOREIGN KEY (tenant_id, learning_path_id)
    REFERENCES learning_paths(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    publication_state = 'draft'
    OR (content_hash IS NOT NULL AND published_at IS NOT NULL AND published_by_membership_id IS NOT NULL)
  )
);

ALTER TABLE learning_paths
  ADD CONSTRAINT fk_paths_current_version
  FOREIGN KEY (tenant_id, current_published_version_id)
  REFERENCES learning_path_versions(tenant_id, id) ON DELETE RESTRICT;

CREATE TABLE path_nodes (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learning_path_version_id uuid NOT NULL,
  node_key varchar(100) NOT NULL,
  task_version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  slot_key_template varchar(180) NOT NULL,
  available_offset_days integer NOT NULL DEFAULT 0,
  due_offset_days integer,
  close_offset_days integer,
  is_required boolean NOT NULL DEFAULT true,
  unlock_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, learning_path_version_id, id),
  UNIQUE (tenant_id, learning_path_version_id, node_key),
  UNIQUE (tenant_id, learning_path_version_id, position),
  FOREIGN KEY (tenant_id, learning_path_version_id)
    REFERENCES learning_path_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, task_version_id)
    REFERENCES task_versions(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (due_offset_days IS NULL OR due_offset_days >= available_offset_days)
    AND (close_offset_days IS NULL OR close_offset_days >= COALESCE(due_offset_days, available_offset_days))
  )
);

CREATE TABLE path_prerequisites (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  learning_path_version_id uuid NOT NULL,
  path_node_id uuid NOT NULL,
  prerequisite_node_id uuid NOT NULL,
  condition prerequisite_condition NOT NULL,
  threshold numeric(8,2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, path_node_id, prerequisite_node_id),
  FOREIGN KEY (tenant_id, learning_path_version_id)
    REFERENCES learning_path_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, learning_path_version_id, path_node_id)
    REFERENCES path_nodes(tenant_id, learning_path_version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, learning_path_version_id, prerequisite_node_id)
    REFERENCES path_nodes(tenant_id, learning_path_version_id, id) ON DELETE RESTRICT,
  CHECK (path_node_id <> prerequisite_node_id),
  CHECK ((condition = 'min_score') = (threshold IS NOT NULL))
);

ALTER TABLE student_exam_goals
  ADD CONSTRAINT uq_exam_goals_tenant_id_student
  UNIQUE (tenant_id, id, student_profile_id);

CREATE TABLE student_path_enrollments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_profile_id uuid NOT NULL,
  learning_path_version_id uuid NOT NULL,
  student_exam_goal_id uuid,
  source enrollment_source NOT NULL,
  status enrollment_status NOT NULL DEFAULT 'active',
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  target_completion_date date,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  assigned_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, learning_path_version_id, student_profile_id),
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, learning_path_version_id)
    REFERENCES learning_path_versions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_exam_goal_id, student_profile_id)
    REFERENCES student_exam_goals(tenant_id, id, student_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((source = 'exam_goal') = (student_exam_goal_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_active_path_enrollment
  ON student_path_enrollments(tenant_id, student_profile_id, learning_path_version_id)
  WHERE status IN ('active', 'paused');
CREATE INDEX ix_path_enrollments_student
  ON student_path_enrollments(tenant_id, student_profile_id, status);

CREATE TRIGGER trg_contents_updated_at BEFORE UPDATE ON contents
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_content_versions_updated_at BEFORE UPDATE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_question_versions_updated_at BEFORE UPDATE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_task_versions_updated_at BEFORE UPDATE ON task_versions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_paths_updated_at BEFORE UPDATE ON learning_paths
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_path_versions_updated_at BEFORE UPDATE ON learning_path_versions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_path_enrollments_updated_at BEFORE UPDATE ON student_path_enrollments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER trg_content_versions_immutable
  BEFORE UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION app.protect_published_version();
CREATE TRIGGER trg_question_versions_immutable
  BEFORE UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION app.protect_published_version();
CREATE TRIGGER trg_task_versions_immutable
  BEFORE UPDATE OR DELETE ON task_versions
  FOR EACH ROW EXECUTE FUNCTION app.protect_published_version();
CREATE TRIGGER trg_path_versions_immutable
  BEFORE UPDATE OR DELETE ON learning_path_versions
  FOR EACH ROW EXECUTE FUNCTION app.protect_published_version();

CREATE TRIGGER trg_content_items_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON content_version_items
  FOR EACH ROW EXECUTE FUNCTION app.protect_child_of_published('content_versions', 'content_version_id');
CREATE TRIGGER trg_path_nodes_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON path_nodes
  FOR EACH ROW EXECUTE FUNCTION app.protect_child_of_published(
    'learning_path_versions', 'learning_path_version_id'
  );
CREATE TRIGGER trg_path_prerequisites_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON path_prerequisites
  FOR EACH ROW EXECUTE FUNCTION app.protect_child_of_published(
    'learning_path_versions', 'learning_path_version_id'
  );
