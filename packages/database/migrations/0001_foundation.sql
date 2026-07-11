CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS platform;

CREATE OR REPLACE FUNCTION app.uuid_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
AS $function$
DECLARE
  unix_ms bigint;
  bytes bytea;
BEGIN
  unix_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  bytes := substring(int8send(unix_ms) FROM 3 FOR 6) || gen_random_bytes(10);
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  RETURN encode(bytes, 'hex')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_membership_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting('app.membership_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_worker_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting('app.worker_id', true), '')
$function$;

CREATE OR REPLACE FUNCTION app.has_request_principal()
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE
AS $function$
  SELECT app.current_membership_id() IS NOT NULL
    OR (current_user = 'english_worker' AND app.current_worker_id() IS NOT NULL)
$function$;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE user_status AS ENUM ('active', 'locked', 'disabled');
CREATE TYPE platform_role AS ENUM ('none', 'super_admin');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended', 'left');
CREATE TYPE profile_status AS ENUM ('active', 'inactive');
CREATE TYPE teacher_link_type AS ENUM ('primary', 'advisor', 'subject');
CREATE TYPE class_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE class_teacher_role AS ENUM ('lead', 'assistant', 'grader');
CREATE TYPE platform_publication_status AS ENUM ('draft', 'published', 'retired');
CREATE TYPE goal_status AS ENUM ('active', 'achieved', 'cancelled');
CREATE TYPE catalog_entity_status AS ENUM ('active', 'archived');
CREATE TYPE publication_state AS ENUM ('draft', 'published');
CREATE TYPE content_kind AS ENUM ('lesson', 'passage', 'question_set', 'writing_prompt');
CREATE TYPE question_kind AS ENUM (
  'single_choice', 'multiple_choice', 'true_false', 'short_text', 'essay'
);
CREATE TYPE task_kind AS ENUM ('lesson', 'practice', 'assessment', 'writing');
CREATE TYPE learning_track AS ENUM ('general', 'toefl');
CREATE TYPE prerequisite_condition AS ENUM ('completed', 'min_score');
CREATE TYPE enrollment_source AS ENUM ('manual', 'general', 'exam_goal');
CREATE TYPE enrollment_status AS ENUM ('active', 'paused', 'completed', 'cancelled');
CREATE TYPE assignment_source AS ENUM (
  'admin_forced', 'individual', 'class', 'exam_path', 'general'
);
CREATE TYPE assignment_schedule_mode AS ENUM ('absolute', 'path_relative');
CREATE TYPE late_policy AS ENUM ('deny', 'allow', 'allow_with_penalty');
CREATE TYPE assignment_status AS ENUM ('draft', 'published', 'cancelled');
CREATE TYPE resolution_state AS ENUM ('active', 'hidden', 'superseded');
CREATE TYPE resolution_reason AS ENUM (
  'winner', 'override_hidden', 'source_inactive', 'slot_conflict', 'replaced'
);
CREATE TYPE workflow_state AS ENUM (
  'not_started', 'in_progress', 'submitted', 'grading', 'returned', 'completed', 'cancelled'
);
CREATE TYPE attempt_state AS ENUM (
  'in_progress', 'submitted', 'grading', 'returned', 'completed', 'cancelled'
);
CREATE TYPE source_inactive_reason AS ENUM (
  'left_target', 'enrollment_paused', 'assignment_cancelled', 'path_completed', 'other'
);
CREATE TYPE override_action AS ENUM ('hide', 'restore', 'replace', 'reschedule', 'require_redo');
CREATE TYPE score_decision_type AS ENUM (
  'auto_scored', 'teacher_confirmed', 'admin_override'
);
CREATE TYPE feedback_type AS ENUM ('system', 'rubric', 'teacher');
CREATE TYPE feedback_visibility AS ENUM ('student', 'internal');
CREATE TYPE file_category AS ENUM (
  'content_attachment', 'submission_attachment', 'profile_image', 'bulk_import'
);
CREATE TYPE file_status AS ENUM ('pending', 'ready', 'quarantined', 'deleted');
CREATE TYPE projection_type AS ENUM ('overall', 'skill', 'path');
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'published', 'dead');
CREATE TYPE idempotency_status AS ENUM ('in_progress', 'succeeded', 'failed');
CREATE TYPE audit_actor_type AS ENUM ('user', 'worker', 'system');

CREATE TABLE platform.exams (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code varchar(40) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  score_schema jsonb NOT NULL,
  status platform_publication_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_platform_exam_publish
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE TABLE platform.contents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind content_kind NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE platform.content_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  content_id uuid NOT NULL REFERENCES platform.contents(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  title varchar(240) NOT NULL,
  locale varchar(16) NOT NULL DEFAULT 'en',
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (content_id, version_no)
);

ALTER TABLE platform.contents
  ADD CONSTRAINT fk_platform_contents_current_version
  FOREIGN KEY (current_published_version_id)
  REFERENCES platform.content_versions(id) ON DELETE RESTRICT;

CREATE TABLE platform.questions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  kind question_kind NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE platform.question_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  question_id uuid NOT NULL REFERENCES platform.questions(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  prompt jsonb NOT NULL,
  options jsonb,
  answer_key jsonb,
  scoring_rule jsonb NOT NULL,
  max_score numeric(8,2) NOT NULL CHECK (max_score > 0),
  content_hash char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (question_id, version_no)
);

ALTER TABLE platform.questions
  ADD CONSTRAINT fk_platform_questions_current_version
  FOREIGN KEY (current_published_version_id)
  REFERENCES platform.question_versions(id) ON DELETE RESTRICT;

CREATE TABLE platform.content_version_items (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  content_version_id uuid NOT NULL REFERENCES platform.content_versions(id) ON DELETE RESTRICT,
  question_version_id uuid NOT NULL REFERENCES platform.question_versions(id) ON DELETE RESTRICT,
  section_key varchar(80),
  position integer NOT NULL CHECK (position >= 0),
  points numeric(8,2) NOT NULL CHECK (points > 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (content_version_id, position),
  UNIQUE (content_version_id, question_version_id)
);

CREATE TABLE platform.tasks (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug varchar(120) NOT NULL UNIQUE,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE platform.task_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  task_id uuid NOT NULL REFERENCES platform.tasks(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  task_kind task_kind NOT NULL,
  title varchar(240) NOT NULL,
  instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_version_id uuid NOT NULL REFERENCES platform.content_versions(id) ON DELETE RESTRICT,
  completion_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  grading_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_minutes smallint CHECK (estimated_minutes > 0),
  content_hash char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (task_id, version_no)
);

ALTER TABLE platform.tasks
  ADD CONSTRAINT fk_platform_tasks_current_version
  FOREIGN KEY (current_published_version_id)
  REFERENCES platform.task_versions(id) ON DELETE RESTRICT;

CREATE TABLE platform.learning_paths (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug varchar(120) NOT NULL UNIQUE,
  track learning_track NOT NULL,
  exam_id uuid REFERENCES platform.exams(id) ON DELETE RESTRICT,
  status catalog_entity_status NOT NULL DEFAULT 'active',
  current_published_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_platform_path_exam
    CHECK ((track = 'toefl') = (exam_id IS NOT NULL))
);

CREATE TABLE platform.learning_path_versions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  learning_path_id uuid NOT NULL REFERENCES platform.learning_paths(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  publication_state publication_state NOT NULL DEFAULT 'draft',
  title varchar(240) NOT NULL,
  description text,
  completion_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (learning_path_id, version_no)
);

ALTER TABLE platform.learning_paths
  ADD CONSTRAINT fk_platform_paths_current_version
  FOREIGN KEY (current_published_version_id)
  REFERENCES platform.learning_path_versions(id) ON DELETE RESTRICT;

CREATE TABLE platform.path_nodes (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  learning_path_version_id uuid NOT NULL
    REFERENCES platform.learning_path_versions(id) ON DELETE RESTRICT,
  node_key varchar(100) NOT NULL,
  task_version_id uuid NOT NULL REFERENCES platform.task_versions(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  slot_key_template varchar(180) NOT NULL,
  available_offset_days integer NOT NULL DEFAULT 0,
  due_offset_days integer,
  close_offset_days integer,
  is_required boolean NOT NULL DEFAULT true,
  unlock_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (learning_path_version_id, node_key),
  UNIQUE (learning_path_version_id, position),
  CONSTRAINT ck_platform_node_offsets CHECK (
    (due_offset_days IS NULL OR due_offset_days >= available_offset_days)
    AND (close_offset_days IS NULL OR close_offset_days >= COALESCE(due_offset_days, available_offset_days))
  )
);

CREATE TABLE platform.path_prerequisites (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  learning_path_version_id uuid NOT NULL
    REFERENCES platform.learning_path_versions(id) ON DELETE RESTRICT,
  path_node_id uuid NOT NULL REFERENCES platform.path_nodes(id) ON DELETE RESTRICT,
  prerequisite_node_id uuid NOT NULL REFERENCES platform.path_nodes(id) ON DELETE RESTRICT,
  condition prerequisite_condition NOT NULL,
  threshold numeric(8,2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (path_node_id, prerequisite_node_id),
  CHECK (path_node_id <> prerequisite_node_id),
  CHECK ((condition = 'min_score') = (threshold IS NOT NULL))
);

CREATE VIEW platform.published_exams AS
SELECT * FROM platform.exams WHERE status = 'published';

CREATE VIEW platform.published_contents AS
SELECT c.*, v.id AS version_id, v.version_no, v.title, v.locale, v.body, v.metadata, v.content_hash,
       v.published_at
FROM platform.contents c
JOIN platform.content_versions v ON v.id = c.current_published_version_id
WHERE c.status = 'active' AND v.publication_state = 'published';

CREATE VIEW platform.published_questions AS
SELECT q.*, v.id AS version_id, v.version_no, v.prompt, v.options, v.scoring_rule, v.max_score,
       v.content_hash, v.published_at
FROM platform.questions q
JOIN platform.question_versions v ON v.id = q.current_published_version_id
WHERE q.status = 'active' AND v.publication_state = 'published';

CREATE VIEW platform.published_tasks AS
SELECT t.*, v.id AS version_id, v.version_no, v.task_kind, v.title, v.instructions,
       v.content_version_id, v.completion_rule, v.grading_policy, v.estimated_minutes,
       v.content_hash, v.published_at
FROM platform.tasks t
JOIN platform.task_versions v ON v.id = t.current_published_version_id
WHERE t.status = 'active' AND v.publication_state = 'published';

CREATE VIEW platform.published_learning_paths AS
SELECT p.*, v.id AS version_id, v.version_no, v.title, v.description, v.completion_rule,
       v.content_hash, v.published_at
FROM platform.learning_paths p
JOIN platform.learning_path_versions v ON v.id = p.current_published_version_id
WHERE p.status = 'active' AND v.publication_state = 'published';

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code varchar(50) NOT NULL UNIQUE,
  slug varchar(64) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  status tenant_status NOT NULL DEFAULT 'active',
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  email_normalized citext,
  phone_e164 varchar(20),
  password_hash text NOT NULL,
  display_name varchar(100) NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  platform_role platform_role NOT NULL DEFAULT 'none',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (email_normalized IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX uq_users_email ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX uq_users_phone ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status membership_status NOT NULL DEFAULT 'invited',
  invited_by_membership_id uuid,
  joined_at timestamptz,
  suspended_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, invited_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_memberships_login
  ON tenant_memberships(tenant_id, user_id, status);

CREATE TABLE membership_roles (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code varchar(40) NOT NULL,
  name varchar(80) NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE membership_role_assignments (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id, role_id),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, role_id)
    REFERENCES membership_roles(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, granted_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  active_tenant_id uuid,
  active_membership_id uuid,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  reuse_detected_at timestamptz,
  ip_hash char(64),
  user_agent_hash char(64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((active_tenant_id IS NULL) = (active_membership_id IS NULL)),
  FOREIGN KEY (active_tenant_id, active_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX ix_auth_sessions_family ON auth_sessions(family_id);
CREATE INDEX ix_auth_sessions_user ON auth_sessions(user_id, expires_at DESC);

CREATE TABLE student_profiles (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  student_no varchar(64),
  grade_level varchar(32),
  date_of_birth date,
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  status profile_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_student_profiles_no
  ON student_profiles(tenant_id, student_no) WHERE student_no IS NOT NULL;

CREATE TABLE teacher_profiles (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  employee_no varchar(64),
  specialties text[] NOT NULL DEFAULT '{}',
  status profile_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_teacher_profiles_no
  ON teacher_profiles(tenant_id, employee_no) WHERE employee_no IS NOT NULL;

CREATE TABLE student_teacher_links (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_profile_id uuid NOT NULL,
  teacher_profile_id uuid NOT NULL,
  relationship_type teacher_link_type NOT NULL,
  subject_code varchar(40),
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, teacher_profile_id)
    REFERENCES teacher_profiles(tenant_id, id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK ((relationship_type = 'subject') = (subject_code IS NOT NULL))
);

ALTER TABLE student_teacher_links
  ADD CONSTRAINT ex_student_primary_teacher
  EXCLUDE USING gist (
    tenant_id WITH =,
    student_profile_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (relationship_type = 'primary');

CREATE INDEX ix_teacher_student_links
  ON student_teacher_links(tenant_id, teacher_profile_id, student_profile_id, valid_to);

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code varchar(50) NOT NULL,
  name varchar(120) NOT NULL,
  status class_status NOT NULL DEFAULT 'draft',
  starts_on date,
  ends_on date,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE class_teachers (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL,
  teacher_profile_id uuid NOT NULL,
  role class_teacher_role NOT NULL DEFAULT 'lead',
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id)
    REFERENCES classes(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, teacher_profile_id)
    REFERENCES teacher_profiles(tenant_id, id) ON DELETE RESTRICT,
  CHECK (left_at IS NULL OR left_at > joined_at)
);

CREATE UNIQUE INDEX uq_active_class_teacher
  ON class_teachers(tenant_id, class_id, teacher_profile_id) WHERE left_at IS NULL;

CREATE TABLE class_students (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL,
  student_profile_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, class_id, student_profile_id),
  FOREIGN KEY (tenant_id, class_id)
    REFERENCES classes(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT,
  CHECK (left_at IS NULL OR left_at > joined_at)
);

CREATE UNIQUE INDEX uq_active_class_student
  ON class_students(tenant_id, class_id, student_profile_id) WHERE left_at IS NULL;
CREATE INDEX ix_class_students_student
  ON class_students(tenant_id, student_profile_id, left_at);

CREATE TABLE student_exam_goals (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_profile_id uuid NOT NULL,
  exam_id uuid NOT NULL REFERENCES platform.exams(id) ON DELETE RESTRICT,
  target_score numeric(8,2),
  target_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_date date,
  is_primary boolean NOT NULL DEFAULT false,
  status goal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_profile_id)
    REFERENCES student_profiles(tenant_id, id) ON DELETE RESTRICT,
  CHECK (target_score IS NULL OR target_score >= 0)
);

CREATE UNIQUE INDEX uq_active_exam_goal
  ON student_exam_goals(tenant_id, student_profile_id, exam_id) WHERE status = 'active';
CREATE UNIQUE INDEX uq_primary_exam_goal
  ON student_exam_goals(tenant_id, student_profile_id) WHERE status = 'active' AND is_primary;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON membership_roles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_student_profiles_updated_at BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_teacher_profiles_updated_at BEFORE UPDATE ON teacher_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_exam_goals_updated_at BEFORE UPDATE ON student_exam_goals
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
