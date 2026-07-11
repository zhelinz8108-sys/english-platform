DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_assessment_owner') THEN
    CREATE ROLE english_assessment_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE english_assessment_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END;
$roles$;

CREATE OR REPLACE FUNCTION app.create_attempt_snapshots(p_attempt_id uuid)
RETURNS TABLE (snapshot_hash char(64), item_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  context_tenant_id uuid := app.current_tenant_id();
  context_membership_id uuid := app.current_membership_id();
  attempt_tenant_id uuid;
  attempt_student_profile_id uuid;
  attempt_task_version_id uuid;
  existing_count integer;
  result_hash char(64);
  inserted_count integer;
BEGIN
  IF context_tenant_id IS NULL OR context_membership_id IS NULL THEN
    RAISE EXCEPTION 'tenant membership context is required' USING ERRCODE = '42501';
  END IF;

  SELECT attempt.tenant_id, item.student_profile_id, item.task_version_id
  INTO attempt_tenant_id, attempt_student_profile_id, attempt_task_version_id
  FROM task_attempts attempt
  JOIN student_task_items item
    ON item.tenant_id = attempt.tenant_id AND item.id = attempt.student_task_item_id
  WHERE attempt.id = p_attempt_id
    AND attempt.tenant_id = context_tenant_id
    AND attempt.state = 'in_progress'
  FOR UPDATE OF attempt;

  IF attempt_tenant_id IS NULL THEN
    RAISE EXCEPTION 'attempt not found or not in_progress' USING ERRCODE = '02000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM student_profiles profile
    WHERE profile.tenant_id = context_tenant_id
      AND profile.id = attempt_student_profile_id
      AND profile.membership_id = context_membership_id
      AND profile.status = 'active'
  ) THEN
    RAISE EXCEPTION 'only the owning student can create attempt snapshots'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO existing_count
  FROM attempt_item_snapshots
  WHERE tenant_id = context_tenant_id AND task_attempt_id = p_attempt_id;
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'attempt snapshots already exist' USING ERRCODE = '23505';
  END IF;

  INSERT INTO attempt_item_snapshots (
    id,
    tenant_id,
    task_attempt_id,
    position,
    content_version_item_id,
    question_version_id,
    prompt_snapshot,
    options_snapshot,
    option_order,
    answer_key_snapshot,
    scoring_rule_snapshot,
    max_score,
    snapshot_hash,
    created_at
  )
  SELECT
    app.uuid_v7(),
    context_tenant_id,
    p_attempt_id,
    item.position,
    item.id,
    version.id,
    version.prompt,
    version.options,
    CASE
      WHEN jsonb_typeof(version.options) = 'array' THEN (
        SELECT jsonb_agg(option.value ->> 'option_id' ORDER BY option.ordinality)
        FROM jsonb_array_elements(version.options)
          WITH ORDINALITY AS option(value, ordinality)
      )
      ELSE NULL
    END,
    version.answer_key,
    version.scoring_rule,
    item.points,
    encode(
      digest(
        concat_ws(
          '|',
          item.position::text,
          version.id::text,
          version.prompt::text,
          COALESCE(version.options::text, 'null'),
          COALESCE(version.answer_key::text, 'null'),
          version.scoring_rule::text,
          item.points::text
        ),
        'sha256'
      ),
      'hex'
    ),
    clock_timestamp()
  FROM task_versions task_version
  JOIN content_versions content_version
    ON content_version.tenant_id = task_version.tenant_id
   AND content_version.id = task_version.content_version_id
  JOIN content_version_items item
    ON item.tenant_id = content_version.tenant_id
   AND item.content_version_id = content_version.id
  JOIN question_versions version
    ON version.tenant_id = item.tenant_id
   AND version.id = item.question_version_id
  WHERE task_version.tenant_id = context_tenant_id
    AND task_version.id = attempt_task_version_id
    AND task_version.publication_state = 'published'
    AND content_version.publication_state = 'published'
    AND version.publication_state = 'published'
  ORDER BY item.position, item.id;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 0 THEN
    RAISE EXCEPTION 'published task has no snapshot items' USING ERRCODE = '23514';
  END IF;

  SELECT encode(
    digest(string_agg(snapshot.snapshot_hash::text, '' ORDER BY snapshot.position, snapshot.id), 'sha256'),
    'hex'
  )::char(64)
  INTO result_hash
  FROM attempt_item_snapshots snapshot
  WHERE snapshot.tenant_id = context_tenant_id
    AND snapshot.task_attempt_id = p_attempt_id;

  UPDATE task_attempts
  SET snapshot_hash = result_hash,
      updated_at = clock_timestamp()
  WHERE tenant_id = context_tenant_id AND id = p_attempt_id;

  RETURN QUERY SELECT result_hash, inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION app.publish_question_version(p_question_version_id uuid)
RETURNS TABLE (
  content_hash char(64),
  published_at timestamptz,
  question_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  context_tenant_id uuid := app.current_tenant_id();
  context_membership_id uuid := app.current_membership_id();
  version_row question_versions%ROWTYPE;
  question_kind_value question_kind;
  calculated_hash char(64);
  publication_time timestamptz;
BEGIN
  IF context_tenant_id IS NULL OR context_membership_id IS NULL THEN
    RAISE EXCEPTION 'tenant membership context is required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM membership_role_assignments assignment
    JOIN membership_roles role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
    JOIN tenant_memberships membership
      ON membership.tenant_id = assignment.tenant_id AND membership.id = assignment.membership_id
    WHERE assignment.tenant_id = context_tenant_id
      AND assignment.membership_id = context_membership_id
      AND membership.status = 'active'
      AND role.code IN ('owner', 'admin', 'content_editor')
  ) THEN
    RAISE EXCEPTION 'content author role is required' USING ERRCODE = '42501';
  END IF;

  SELECT version.* INTO version_row
  FROM question_versions version
  WHERE version.tenant_id = context_tenant_id
    AND version.id = p_question_version_id
  FOR UPDATE;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'question version not found' USING ERRCODE = '02000';
  END IF;

  SELECT question.kind INTO question_kind_value
  FROM questions question
  WHERE question.tenant_id = context_tenant_id AND question.id = version_row.question_id;

  IF question_kind_value IN ('single_choice', 'multiple_choice', 'true_false')
     AND (version_row.options IS NULL OR version_row.answer_key IS NULL) THEN
    RAISE EXCEPTION 'objective question requires options and answer_key' USING ERRCODE = '23514';
  END IF;
  IF question_kind_value = 'short_text' AND version_row.answer_key IS NULL THEN
    RAISE EXCEPTION 'short_text question requires answer_key' USING ERRCODE = '23514';
  END IF;

  IF version_row.publication_state = 'published' THEN
    RETURN QUERY
    SELECT version_row.content_hash, version_row.published_at, version_row.question_id;
    RETURN;
  END IF;

  calculated_hash := encode(
    digest(
      concat_ws(
        '|',
        version_row.question_id::text,
        version_row.version_no::text,
        question_kind_value::text,
        version_row.prompt::text,
        COALESCE(version_row.options::text, 'null'),
        COALESCE(version_row.answer_key::text, 'null'),
        version_row.scoring_rule::text,
        version_row.max_score::text
      ),
      'sha256'
    ),
    'hex'
  )::char(64);
  publication_time := clock_timestamp();

  UPDATE question_versions
  SET publication_state = 'published',
      content_hash = calculated_hash,
      published_at = publication_time,
      published_by_membership_id = context_membership_id,
      updated_at = publication_time
  WHERE tenant_id = context_tenant_id AND id = p_question_version_id;

  UPDATE questions
  SET current_published_version_id = p_question_version_id,
      updated_at = publication_time
  WHERE tenant_id = context_tenant_id AND id = version_row.question_id;

  RETURN QUERY SELECT calculated_hash, publication_time, version_row.question_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app.get_question_versions_for_authoring(p_question_id uuid)
RETURNS SETOF question_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  context_tenant_id uuid := app.current_tenant_id();
  context_membership_id uuid := app.current_membership_id();
BEGIN
  IF context_tenant_id IS NULL OR context_membership_id IS NULL THEN
    RAISE EXCEPTION 'tenant membership context is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM membership_role_assignments assignment
    JOIN membership_roles role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
    JOIN tenant_memberships membership
      ON membership.tenant_id = assignment.tenant_id AND membership.id = assignment.membership_id
    WHERE assignment.tenant_id = context_tenant_id
      AND assignment.membership_id = context_membership_id
      AND membership.status = 'active'
      AND role.code IN ('owner', 'admin', 'content_editor')
  ) THEN
    RAISE EXCEPTION 'content author role is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT version.*
  FROM question_versions version
  WHERE version.tenant_id = context_tenant_id
    AND version.question_id = p_question_id
  ORDER BY version.version_no DESC;
END;
$function$;

REVOKE ALL ON FUNCTION app.create_attempt_snapshots(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_question_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_question_versions_for_authoring(uuid) FROM PUBLIC;

ALTER FUNCTION app.create_attempt_snapshots(uuid) OWNER TO english_assessment_owner;
ALTER FUNCTION app.publish_question_version(uuid) OWNER TO english_assessment_owner;
ALTER FUNCTION app.get_question_versions_for_authoring(uuid) OWNER TO english_assessment_owner;

GRANT USAGE ON SCHEMA public, app TO english_assessment_owner;
GRANT SELECT ON
  tenant_memberships,
  membership_roles,
  membership_role_assignments,
  student_profiles,
  student_task_items,
  task_attempts,
  task_versions,
  content_versions,
  content_version_items,
  questions,
  question_versions,
  attempt_item_snapshots
TO english_assessment_owner;
GRANT INSERT ON attempt_item_snapshots TO english_assessment_owner;
GRANT UPDATE ON task_attempts, question_versions, questions TO english_assessment_owner;

GRANT EXECUTE ON FUNCTION app.create_attempt_snapshots(uuid) TO english_app;
GRANT EXECUTE ON FUNCTION app.publish_question_version(uuid) TO english_app;
GRANT EXECUTE ON FUNCTION app.get_question_versions_for_authoring(uuid) TO english_app;
