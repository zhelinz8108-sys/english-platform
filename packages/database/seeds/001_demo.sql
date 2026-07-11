-- Idempotent demo data. The seed runner replaces the password placeholder with
-- an Argon2id hash. Demo logins share the password supplied by DEMO_PASSWORD
-- (default: Demo123!).

INSERT INTO platform.exams (
  id, code, name, score_schema, status, published_at
) VALUES (
  '0194b000-0000-7000-8000-000000000001',
  'toefl',
  'TOEFL iBT',
  '{"minimum":0,"maximum":120,"components":{"reading":30,"listening":30,"speaking":30,"writing":30}}',
  'published',
  '2026-01-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.contents (
  id, kind, slug, status
) VALUES (
  '0194b000-0000-7000-8000-000000000101',
  'passage',
  'official-academic-feedback',
  'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.content_versions (
  id, content_id, version_no, publication_state, title, locale, body, metadata,
  content_hash, published_at
) VALUES (
  '0194b000-0000-7000-8000-000000000111',
  '0194b000-0000-7000-8000-000000000101',
  1,
  'published',
  'Official General · Using Feedback Effectively',
  'en',
  '{"type":"passage","text":"Effective learners compare feedback with their original goal, revise one decision at a time, and check whether the revision improved clarity."}',
  '{"track":"general","level":"B1","official":true}',
  encode(digest('official-academic-feedback-v1', 'sha256'), 'hex'),
  '2026-01-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

UPDATE platform.contents
SET current_published_version_id = '0194b000-0000-7000-8000-000000000111',
    updated_at = clock_timestamp()
WHERE id = '0194b000-0000-7000-8000-000000000101'
  AND current_published_version_id IS DISTINCT FROM '0194b000-0000-7000-8000-000000000111'::uuid;

INSERT INTO tenants (
  id, code, slug, name, status, timezone, locale, settings
) VALUES (
  '0194a000-0000-7000-8000-000000000001',
  'demo_academy',
  'demo-academy',
  '演示英语学院',
  'active',
  'Asia/Shanghai',
  'zh-CN',
  '{"previewWindowDays":7,"defaultLatePolicy":"allow"}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
  id, email_normalized, password_hash, display_name, status, platform_role
) VALUES
  (
    '0194a000-0000-7000-8000-000000000101',
    'owner@example.test',
    __DEMO_PASSWORD_HASH__,
    '演示机构管理员',
    'active',
    'none'
  ),
  (
    '0194a000-0000-7000-8000-000000000102',
    'teacher@example.test',
    __DEMO_PASSWORD_HASH__,
    '演示教师',
    'active',
    'none'
  ),
  (
    '0194a000-0000-7000-8000-000000000103',
    'student@example.test',
    __DEMO_PASSWORD_HASH__,
    '演示学生',
    'active',
    'none'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_memberships (
  id, tenant_id, user_id, status, joined_at
) VALUES
  (
    '0194a000-0000-7000-8000-000000000201',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000000101',
    'active',
    '2026-01-01T00:00:00Z'
  ),
  (
    '0194a000-0000-7000-8000-000000000202',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000000102',
    'active',
    '2026-01-01T00:00:00Z'
  ),
  (
    '0194a000-0000-7000-8000-000000000203',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000000103',
    'active',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO membership_roles (
  id, tenant_id, code, name, permissions, is_system
) VALUES
  ('0194a000-0000-7000-8000-000000000301', '0194a000-0000-7000-8000-000000000001',
   'owner', '机构所有者', '["tenant:*"]', true),
  ('0194a000-0000-7000-8000-000000000302', '0194a000-0000-7000-8000-000000000001',
   'admin', '管理员', '["tenant:manage","catalog:manage","assignment:manage"]', true),
  ('0194a000-0000-7000-8000-000000000303', '0194a000-0000-7000-8000-000000000001',
   'teacher', '教师', '["class:manage","assignment:create","assessment:grade"]', true),
  ('0194a000-0000-7000-8000-000000000304', '0194a000-0000-7000-8000-000000000001',
   'student', '学生', '["task:read","attempt:write","progress:read"]', true),
  ('0194a000-0000-7000-8000-000000000305', '0194a000-0000-7000-8000-000000000001',
   'content_editor', '内容编辑', '["catalog:write","catalog:publish"]', true),
  ('0194a000-0000-7000-8000-000000000306', '0194a000-0000-7000-8000-000000000001',
   'analyst', '分析员', '["progress:aggregate"]', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO membership_role_assignments (
  id, tenant_id, membership_id, role_id, granted_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000000311', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000000201', '0194a000-0000-7000-8000-000000000301',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000000312', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000000202', '0194a000-0000-7000-8000-000000000303',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000000313', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000000203', '0194a000-0000-7000-8000-000000000304',
   '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO teacher_profiles (
  id, tenant_id, membership_id, employee_no, specialties, status
) VALUES (
  '0194a000-0000-7000-8000-000000000401',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000202',
  'T-DEMO-001',
  ARRAY['general','toefl','writing'],
  'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO student_profiles (
  id, tenant_id, membership_id, student_no, grade_level, locale, timezone, status
) VALUES (
  '0194a000-0000-7000-8000-000000000402',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000203',
  'S-DEMO-001',
  'high_school',
  'zh-CN',
  'Asia/Shanghai',
  'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO student_teacher_links (
  id, tenant_id, student_profile_id, teacher_profile_id, relationship_type, valid_from
) SELECT
  '0194a000-0000-7000-8000-000000000403',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000402',
  '0194a000-0000-7000-8000-000000000401',
  'primary',
  '2026-01-01T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1 FROM student_teacher_links
  WHERE id = '0194a000-0000-7000-8000-000000000403'
);

INSERT INTO classes (
  id, tenant_id, code, name, status, starts_on, created_by_membership_id
) VALUES (
  '0194a000-0000-7000-8000-000000000501',
  '0194a000-0000-7000-8000-000000000001',
  'DEMO-A',
  'General + TOEFL 演示班',
  'active',
  '2026-01-01',
  '0194a000-0000-7000-8000-000000000201'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO class_teachers (
  id, tenant_id, class_id, teacher_profile_id, role, joined_at
) SELECT
  '0194a000-0000-7000-8000-000000000502',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000501',
  '0194a000-0000-7000-8000-000000000401',
  'lead',
  '2026-01-01T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1 FROM class_teachers
  WHERE id = '0194a000-0000-7000-8000-000000000502'
);

INSERT INTO class_students (
  id, tenant_id, class_id, student_profile_id, joined_at
) SELECT
  '0194a000-0000-7000-8000-000000000503',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000501',
  '0194a000-0000-7000-8000-000000000402',
  '2026-01-01T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1 FROM class_students
  WHERE id = '0194a000-0000-7000-8000-000000000503'
);

INSERT INTO student_exam_goals (
  id, tenant_id, student_profile_id, exam_id, target_score, target_date, is_primary, status
) VALUES (
  '0194a000-0000-7000-8000-000000000601',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000000402',
  '0194b000-0000-7000-8000-000000000001',
  100,
  '2026-12-01',
  true,
  'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO questions (
  id, tenant_id, kind, slug, status, created_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001001', '0194a000-0000-7000-8000-000000000001',
   'single_choice', 'general-context-vocabulary', 'active',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001002', '0194a000-0000-7000-8000-000000000001',
   'single_choice', 'toefl-reading-inference', 'active',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001003', '0194a000-0000-7000-8000-000000000001',
   'essay', 'toefl-independent-writing', 'active',
   '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO question_versions (
  id, tenant_id, question_id, version_no, publication_state, prompt, options, answer_key,
  scoring_rule, max_score, content_hash, published_at, published_by_membership_id
) VALUES
  (
    '0194a000-0000-7000-8000-000000001011',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000001001',
    1, 'published',
    '{"format":"plain","text":"The word “meticulous” is closest in meaning to:"}',
    '[{"option_id":"a","text":"careless"},{"option_id":"b","text":"very careful"},{"option_id":"c","text":"rapid"},{"option_id":"d","text":"uncertain"}]',
    '{"correct_option_ids":["b"]}',
    '{"type":"exact_option_set","points":1}',
    1,
    encode(digest('general-context-vocabulary-v1', 'sha256'), 'hex'),
    '2026-01-01T00:00:00Z',
    '0194a000-0000-7000-8000-000000000201'
  ),
  (
    '0194a000-0000-7000-8000-000000001012',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000001002',
    1, 'published',
    '{"format":"plain","text":"What can be inferred about the researchers’ original hypothesis?"}',
    '[{"option_id":"a","text":"It was fully confirmed."},{"option_id":"b","text":"It required revision after new evidence."},{"option_id":"c","text":"It was unrelated to the observations."},{"option_id":"d","text":"It had already been abandoned."}]',
    '{"correct_option_ids":["b"]}',
    '{"type":"exact_option_set","points":1}',
    1,
    encode(digest('toefl-reading-inference-v1', 'sha256'), 'hex'),
    '2026-01-01T00:00:00Z',
    '0194a000-0000-7000-8000-000000000201'
  ),
  (
    '0194a000-0000-7000-8000-000000001013',
    '0194a000-0000-7000-8000-000000000001',
    '0194a000-0000-7000-8000-000000001003',
    1, 'published',
    '{"format":"plain","text":"Do you agree or disagree that students learn more effectively in groups? Use reasons and examples."}',
    NULL,
    NULL,
    '{"type":"rubric","rubric":"toefl-writing-v1","requires_teacher":true}',
    30,
    encode(digest('toefl-independent-writing-v1', 'sha256'), 'hex'),
    '2026-01-01T00:00:00Z',
    '0194a000-0000-7000-8000-000000000201'
  )
ON CONFLICT (id) DO NOTHING;

UPDATE questions SET current_published_version_id = CASE id
  WHEN '0194a000-0000-7000-8000-000000001001' THEN '0194a000-0000-7000-8000-000000001011'::uuid
  WHEN '0194a000-0000-7000-8000-000000001002' THEN '0194a000-0000-7000-8000-000000001012'::uuid
  WHEN '0194a000-0000-7000-8000-000000001003' THEN '0194a000-0000-7000-8000-000000001013'::uuid
END
WHERE id IN (
  '0194a000-0000-7000-8000-000000001001',
  '0194a000-0000-7000-8000-000000001002',
  '0194a000-0000-7000-8000-000000001003'
) AND current_published_version_id IS DISTINCT FROM CASE id
  WHEN '0194a000-0000-7000-8000-000000001001' THEN '0194a000-0000-7000-8000-000000001011'::uuid
  WHEN '0194a000-0000-7000-8000-000000001002' THEN '0194a000-0000-7000-8000-000000001012'::uuid
  WHEN '0194a000-0000-7000-8000-000000001003' THEN '0194a000-0000-7000-8000-000000001013'::uuid
END;

INSERT INTO contents (
  id, tenant_id, kind, slug, status, created_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001101', '0194a000-0000-7000-8000-000000000001',
   'question_set', 'general-vocabulary-set', 'active',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001102', '0194a000-0000-7000-8000-000000000001',
   'question_set', 'toefl-reading-set', 'active',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001103', '0194a000-0000-7000-8000-000000000001',
   'writing_prompt', 'toefl-writing-set', 'active',
   '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_versions (
  id, tenant_id, content_id, version_no, publication_state, title, locale, body, metadata
) VALUES
  ('0194a000-0000-7000-8000-000000001111', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001101', 1, 'draft', 'General 语境词汇练习', 'en',
   '{"format":"blocks","blocks":[{"type":"paragraph","text":"Choose the closest meaning."}]}',
   '{"track":"general","skills":["vocabulary"],"cefr":"B2"}'),
  ('0194a000-0000-7000-8000-000000001112', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001102', 1, 'draft', 'TOEFL 阅读推断练习', 'en',
   '{"format":"blocks","blocks":[{"type":"paragraph","text":"New observations caused the research team to revise its initial explanation."}]}',
   '{"track":"toefl","skills":["reading"],"level":"intermediate"}'),
  ('0194a000-0000-7000-8000-000000001113', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001103', 1, 'draft', 'TOEFL 写作练习', 'en',
   '{"format":"blocks","blocks":[{"type":"paragraph","text":"Write a structured response of at least 250 words."}]}',
   '{"track":"toefl","skills":["writing"],"level":"intermediate"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_version_items (
  id, tenant_id, content_version_id, question_version_id, position, points, settings
) SELECT * FROM (VALUES
  ('0194a000-0000-7000-8000-000000001121'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001111'::uuid, '0194a000-0000-7000-8000-000000001011'::uuid,
   0, 1::numeric, '{}'::jsonb),
  ('0194a000-0000-7000-8000-000000001122'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001112'::uuid, '0194a000-0000-7000-8000-000000001012'::uuid,
   0, 1::numeric, '{}'::jsonb),
  ('0194a000-0000-7000-8000-000000001123'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001113'::uuid, '0194a000-0000-7000-8000-000000001013'::uuid,
   0, 30::numeric, '{"min_words":250}'::jsonb)
) AS seed(id, tenant_id, content_version_id, question_version_id, position, points, settings)
WHERE NOT EXISTS (SELECT 1 FROM content_version_items existing WHERE existing.id = seed.id);

UPDATE content_versions
SET publication_state = 'published',
    content_hash = encode(digest(id::text || '-published', 'sha256'), 'hex'),
    published_at = '2026-01-01T00:00:00Z',
    published_by_membership_id = '0194a000-0000-7000-8000-000000000201'
WHERE id IN (
  '0194a000-0000-7000-8000-000000001111',
  '0194a000-0000-7000-8000-000000001112',
  '0194a000-0000-7000-8000-000000001113'
) AND publication_state = 'draft';

UPDATE contents SET current_published_version_id = CASE id
  WHEN '0194a000-0000-7000-8000-000000001101' THEN '0194a000-0000-7000-8000-000000001111'::uuid
  WHEN '0194a000-0000-7000-8000-000000001102' THEN '0194a000-0000-7000-8000-000000001112'::uuid
  WHEN '0194a000-0000-7000-8000-000000001103' THEN '0194a000-0000-7000-8000-000000001113'::uuid
END
WHERE id IN (
  '0194a000-0000-7000-8000-000000001101',
  '0194a000-0000-7000-8000-000000001102',
  '0194a000-0000-7000-8000-000000001103'
) AND current_published_version_id IS DISTINCT FROM CASE id
  WHEN '0194a000-0000-7000-8000-000000001101' THEN '0194a000-0000-7000-8000-000000001111'::uuid
  WHEN '0194a000-0000-7000-8000-000000001102' THEN '0194a000-0000-7000-8000-000000001112'::uuid
  WHEN '0194a000-0000-7000-8000-000000001103' THEN '0194a000-0000-7000-8000-000000001113'::uuid
END;

INSERT INTO tasks (
  id, tenant_id, slug, status, created_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001201', '0194a000-0000-7000-8000-000000000001',
   'general-vocabulary-practice', 'active', '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001202', '0194a000-0000-7000-8000-000000000001',
   'toefl-reading-practice', 'active', '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001203', '0194a000-0000-7000-8000-000000000001',
   'toefl-writing-practice', 'active', '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_versions (
  id, tenant_id, task_id, version_no, publication_state, task_kind, title, instructions,
  content_version_id, completion_rule, grading_policy, estimated_minutes, content_hash,
  published_at, published_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001211', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001201', 1, 'published', 'practice',
   'General 语境词汇', '{"text":"完成全部题目"}',
   '0194a000-0000-7000-8000-000000001111', '{"all_items_required":true}',
   '{"mode":"auto","passing_score":1}', 10,
   encode(digest('general-task-v1','sha256'),'hex'), '2026-01-01T00:00:00Z',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001212', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001202', 1, 'published', 'assessment',
   'TOEFL 阅读推断', '{"text":"阅读材料并选择最佳答案"}',
   '0194a000-0000-7000-8000-000000001112', '{"all_items_required":true}',
   '{"mode":"auto","passing_score":1}', 15,
   encode(digest('toefl-reading-task-v1','sha256'),'hex'), '2026-01-01T00:00:00Z',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001213', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001203', 1, 'published', 'writing',
   'TOEFL 独立写作', '{"text":"完成作文并提交教师批改"}',
   '0194a000-0000-7000-8000-000000001113', '{"all_items_required":true}',
   '{"mode":"teacher","rubric":"toefl-writing-v1"}', 35,
   encode(digest('toefl-writing-task-v1','sha256'),'hex'), '2026-01-01T00:00:00Z',
   '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

UPDATE tasks SET current_published_version_id = CASE id
  WHEN '0194a000-0000-7000-8000-000000001201' THEN '0194a000-0000-7000-8000-000000001211'::uuid
  WHEN '0194a000-0000-7000-8000-000000001202' THEN '0194a000-0000-7000-8000-000000001212'::uuid
  WHEN '0194a000-0000-7000-8000-000000001203' THEN '0194a000-0000-7000-8000-000000001213'::uuid
END
WHERE id IN (
  '0194a000-0000-7000-8000-000000001201',
  '0194a000-0000-7000-8000-000000001202',
  '0194a000-0000-7000-8000-000000001203'
) AND current_published_version_id IS DISTINCT FROM CASE id
  WHEN '0194a000-0000-7000-8000-000000001201' THEN '0194a000-0000-7000-8000-000000001211'::uuid
  WHEN '0194a000-0000-7000-8000-000000001202' THEN '0194a000-0000-7000-8000-000000001212'::uuid
  WHEN '0194a000-0000-7000-8000-000000001203' THEN '0194a000-0000-7000-8000-000000001213'::uuid
END;

INSERT INTO learning_paths (
  id, tenant_id, slug, track, exam_id, status, created_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001301', '0194a000-0000-7000-8000-000000000001',
   'general-foundation', 'general', NULL, 'active', '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001302', '0194a000-0000-7000-8000-000000000001',
   'toefl-foundation', 'toefl', '0194b000-0000-7000-8000-000000000001',
   'active', '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO learning_path_versions (
  id, tenant_id, learning_path_id, version_no, publication_state, title, description, completion_rule
) VALUES
  ('0194a000-0000-7000-8000-000000001311', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001301', 1, 'draft', 'General 基础路径',
   '语境词汇基础训练', '{"required_nodes":"all"}'),
  ('0194a000-0000-7000-8000-000000001312', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001302', 1, 'draft', 'TOEFL 基础路径',
   '阅读推断与独立写作', '{"required_nodes":"all"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO path_nodes (
  id, tenant_id, learning_path_version_id, node_key, task_version_id, position,
  slot_key_template, available_offset_days, due_offset_days, close_offset_days,
  is_required, unlock_rule
) SELECT * FROM (VALUES
  ('0194a000-0000-7000-8000-000000001321'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001311'::uuid, 'vocabulary-1',
   '0194a000-0000-7000-8000-000000001211'::uuid, 0,
   'general:vocabulary:{enrollment_id}', 0, 7, 14, true, '{}'::jsonb),
  ('0194a000-0000-7000-8000-000000001322'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001312'::uuid, 'reading-1',
   '0194a000-0000-7000-8000-000000001212'::uuid, 0,
   'toefl:reading:{enrollment_id}', 0, 7, 14, true, '{}'::jsonb),
  ('0194a000-0000-7000-8000-000000001323'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001312'::uuid, 'writing-1',
   '0194a000-0000-7000-8000-000000001213'::uuid, 1,
   'toefl:writing:{enrollment_id}', 7, 14, 21, true, '{}'::jsonb)
) AS seed(
  id, tenant_id, learning_path_version_id, node_key, task_version_id, position,
  slot_key_template, available_offset_days, due_offset_days, close_offset_days,
  is_required, unlock_rule
)
WHERE NOT EXISTS (SELECT 1 FROM path_nodes existing WHERE existing.id = seed.id);

INSERT INTO path_prerequisites (
  id, tenant_id, learning_path_version_id, path_node_id, prerequisite_node_id, condition
) SELECT
  '0194a000-0000-7000-8000-000000001331',
  '0194a000-0000-7000-8000-000000000001',
  '0194a000-0000-7000-8000-000000001312',
  '0194a000-0000-7000-8000-000000001323',
  '0194a000-0000-7000-8000-000000001322',
  'completed'
WHERE NOT EXISTS (
  SELECT 1 FROM path_prerequisites
  WHERE id = '0194a000-0000-7000-8000-000000001331'
);

UPDATE learning_path_versions
SET publication_state = 'published',
    content_hash = encode(digest(id::text || '-published', 'sha256'), 'hex'),
    published_at = '2026-01-01T00:00:00Z',
    published_by_membership_id = '0194a000-0000-7000-8000-000000000201'
WHERE id IN (
  '0194a000-0000-7000-8000-000000001311',
  '0194a000-0000-7000-8000-000000001312'
) AND publication_state = 'draft';

UPDATE learning_paths SET current_published_version_id = CASE id
  WHEN '0194a000-0000-7000-8000-000000001301' THEN '0194a000-0000-7000-8000-000000001311'::uuid
  WHEN '0194a000-0000-7000-8000-000000001302' THEN '0194a000-0000-7000-8000-000000001312'::uuid
END
WHERE id IN (
  '0194a000-0000-7000-8000-000000001301',
  '0194a000-0000-7000-8000-000000001302'
) AND current_published_version_id IS DISTINCT FROM CASE id
  WHEN '0194a000-0000-7000-8000-000000001301' THEN '0194a000-0000-7000-8000-000000001311'::uuid
  WHEN '0194a000-0000-7000-8000-000000001302' THEN '0194a000-0000-7000-8000-000000001312'::uuid
END;

INSERT INTO student_path_enrollments (
  id, tenant_id, student_profile_id, learning_path_version_id, student_exam_goal_id,
  source, status, enrolled_at, target_completion_date, assigned_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001401', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000000402', '0194a000-0000-7000-8000-000000001311',
   NULL, 'general', 'active', '2026-07-01T00:00:00Z', '2026-09-30',
   '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001402', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000000402', '0194a000-0000-7000-8000-000000001312',
   '0194a000-0000-7000-8000-000000000601', 'exam_goal', 'active',
   '2026-07-01T00:00:00Z', '2026-11-30',
   '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_assignments (
  id, tenant_id, task_version_id, source_type, occurrence_key, slot_key,
  explicit_priority, schedule_mode, max_attempts, late_policy, status,
  created_by_membership_id
) VALUES
  ('0194a000-0000-7000-8000-000000001501', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001211', 'general',
   'general:vocabulary:{enrollment_id}', 'general:vocabulary:{enrollment_id}',
   0, 'path_relative', 2, 'allow', 'draft', '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001502', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001212', 'exam_path',
   'toefl:reading:{enrollment_id}', 'toefl:reading:{enrollment_id}',
   0, 'path_relative', 2, 'allow', 'draft', '0194a000-0000-7000-8000-000000000201'),
  ('0194a000-0000-7000-8000-000000001503', '0194a000-0000-7000-8000-000000000001',
   '0194a000-0000-7000-8000-000000001213', 'exam_path',
   'toefl:writing:{enrollment_id}', 'toefl:writing:{enrollment_id}',
   0, 'path_relative', 2, 'allow', 'draft', '0194a000-0000-7000-8000-000000000201')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_assignment_path_targets (
  id, tenant_id, task_assignment_id, path_node_id, learning_path_version_id
) SELECT * FROM (VALUES
  ('0194a000-0000-7000-8000-000000001511'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001501'::uuid, '0194a000-0000-7000-8000-000000001321'::uuid,
   '0194a000-0000-7000-8000-000000001311'::uuid),
  ('0194a000-0000-7000-8000-000000001512'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001502'::uuid, '0194a000-0000-7000-8000-000000001322'::uuid,
   '0194a000-0000-7000-8000-000000001312'::uuid),
  ('0194a000-0000-7000-8000-000000001513'::uuid, '0194a000-0000-7000-8000-000000000001'::uuid,
   '0194a000-0000-7000-8000-000000001503'::uuid, '0194a000-0000-7000-8000-000000001323'::uuid,
   '0194a000-0000-7000-8000-000000001312'::uuid)
) AS seed(id, tenant_id, task_assignment_id, path_node_id, learning_path_version_id)
WHERE NOT EXISTS (
  SELECT 1 FROM task_assignment_path_targets existing WHERE existing.id = seed.id
);

UPDATE task_assignments
SET status = 'published', published_at = '2026-07-01T00:00:00Z'
WHERE id IN (
  '0194a000-0000-7000-8000-000000001501',
  '0194a000-0000-7000-8000-000000001502',
  '0194a000-0000-7000-8000-000000001503'
) AND status = 'draft';

INSERT INTO outbox_events (
  id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status,
  occurred_at, available_at
) VALUES
  ('0194a000-0000-7000-8000-000000001601', '0194a000-0000-7000-8000-000000000001',
   'TaskAssignment', '0194a000-0000-7000-8000-000000001501', 'assignment.published.v1',
   '{"assignmentId":"0194a000-0000-7000-8000-000000001501"}', 'pending',
   '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('0194a000-0000-7000-8000-000000001602', '0194a000-0000-7000-8000-000000000001',
   'TaskAssignment', '0194a000-0000-7000-8000-000000001502', 'assignment.published.v1',
   '{"assignmentId":"0194a000-0000-7000-8000-000000001502"}', 'pending',
   '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('0194a000-0000-7000-8000-000000001603', '0194a000-0000-7000-8000-000000000001',
   'TaskAssignment', '0194a000-0000-7000-8000-000000001503', 'assignment.published.v1',
   '{"assignmentId":"0194a000-0000-7000-8000-000000001503"}', 'pending',
   '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
