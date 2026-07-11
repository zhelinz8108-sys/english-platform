import type { ColumnType, Generated } from 'kysely';

export type Uuid = string;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type DbTimestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
export type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
export type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>;
export type DbDate = ColumnType<string, string, string>;
export type NullableDate = ColumnType<string | null, string | null | undefined, string | null>;
export type DbBigInt = ColumnType<string, string | number | bigint, string | number | bigint>;
export type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;
export type NullableJsonColumn = ColumnType<
  JsonValue | null,
  JsonValue | null | undefined,
  JsonValue | null
>;

export type TenantStatus = 'active' | 'suspended' | 'closed';
export type UserStatus = 'active' | 'locked' | 'disabled';
export type PlatformRole = 'none' | 'super_admin';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'left';
export type ProfileStatus = 'active' | 'inactive';
export type TeacherLinkType = 'primary' | 'advisor' | 'subject';
export type ClassStatus = 'draft' | 'active' | 'archived';
export type ClassTeacherRole = 'lead' | 'assistant' | 'grader';
export type GoalStatus = 'active' | 'achieved' | 'cancelled';
export type CatalogEntityStatus = 'active' | 'archived';
export type PublicationState = 'draft' | 'published';
export type ContentKind = 'lesson' | 'passage' | 'question_set' | 'writing_prompt';
export type QuestionKind =
  'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'essay';
export type TaskKind = 'lesson' | 'practice' | 'assessment' | 'writing';
export type LearningTrack = 'general' | 'toefl';
export type PrerequisiteCondition = 'completed' | 'min_score';
export type EnrollmentSource = 'manual' | 'general' | 'exam_goal';
export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type AssignmentSource = 'admin_forced' | 'individual' | 'class' | 'exam_path' | 'general';
export type AssignmentScheduleMode = 'absolute' | 'path_relative';
export type LatePolicy = 'deny' | 'allow' | 'allow_with_penalty';
export type AssignmentStatus = 'draft' | 'published' | 'cancelled';
export type ResolutionState = 'active' | 'hidden' | 'superseded';
export type ResolutionReason =
  'winner' | 'override_hidden' | 'source_inactive' | 'slot_conflict' | 'replaced';
export type WorkflowState =
  'not_started' | 'in_progress' | 'submitted' | 'grading' | 'returned' | 'completed' | 'cancelled';
export type AttemptState =
  'in_progress' | 'submitted' | 'grading' | 'returned' | 'completed' | 'cancelled';
export type OverrideAction = 'hide' | 'restore' | 'replace' | 'reschedule' | 'require_redo';
export type ScoreDecisionType = 'auto_scored' | 'teacher_confirmed' | 'admin_override';
export type FeedbackType = 'system' | 'rubric' | 'teacher';
export type FeedbackVisibility = 'student' | 'internal';
export type FileCategory =
  'content_attachment' | 'submission_attachment' | 'profile_image' | 'bulk_import';
export type FileStatus = 'pending' | 'ready' | 'quarantined' | 'deleted';
export type ProjectionType = 'overall' | 'skill' | 'path';
export type OutboxStatus = 'pending' | 'processing' | 'published' | 'dead';
export type IdempotencyStatus = 'in_progress' | 'succeeded' | 'failed';
export type AuditActorType = 'user' | 'worker' | 'system';

interface TenantOwned {
  id: Generated<Uuid>;
  tenant_id: Uuid;
}

interface MutableTimestamps {
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

interface ImmutableTimestamp {
  created_at: CreatedAt;
}

export interface TenantsTable {
  id: Generated<Uuid>;
  code: string;
  slug: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  locale: string;
  settings: JsonColumn;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UsersTable {
  id: Generated<Uuid>;
  email_normalized: string | null;
  phone_e164: string | null;
  password_hash: string;
  display_name: string;
  status: UserStatus;
  platform_role: PlatformRole;
  last_login_at: NullableTimestamp;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TenantMembershipsTable extends TenantOwned, MutableTimestamps {
  user_id: Uuid;
  status: MembershipStatus;
  invited_by_membership_id: Uuid | null;
  joined_at: NullableTimestamp;
  suspended_at: NullableTimestamp;
  left_at: NullableTimestamp;
}

export interface MembershipRolesTable extends TenantOwned, MutableTimestamps {
  code: string;
  name: string;
  permissions: JsonColumn;
  is_system: boolean;
}

export interface MembershipRoleAssignmentsTable extends TenantOwned, ImmutableTimestamp {
  membership_id: Uuid;
  role_id: Uuid;
  granted_by_membership_id: Uuid | null;
}

export interface AuthSessionsTable {
  id: Generated<Uuid>;
  user_id: Uuid;
  family_id: Uuid;
  refresh_token_hash: string;
  active_tenant_id: Uuid | null;
  active_membership_id: Uuid | null;
  expires_at: DbTimestamp;
  rotated_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  reuse_detected_at: NullableTimestamp;
  ip_hash: string | null;
  user_agent_hash: string | null;
  created_at: CreatedAt;
}

export interface StudentProfilesTable extends TenantOwned, MutableTimestamps {
  membership_id: Uuid;
  student_no: string | null;
  grade_level: string | null;
  date_of_birth: NullableDate;
  locale: string;
  timezone: string;
  status: ProfileStatus;
}

export interface TeacherProfilesTable extends TenantOwned, MutableTimestamps {
  membership_id: Uuid;
  employee_no: string | null;
  specialties: string[];
  status: ProfileStatus;
}

export interface StudentTeacherLinksTable extends TenantOwned, ImmutableTimestamp {
  student_profile_id: Uuid;
  teacher_profile_id: Uuid;
  relationship_type: TeacherLinkType;
  subject_code: string | null;
  valid_from: DbTimestamp;
  valid_to: NullableTimestamp;
}

export interface ClassesTable extends TenantOwned, MutableTimestamps {
  code: string;
  name: string;
  status: ClassStatus;
  starts_on: NullableDate;
  ends_on: NullableDate;
  created_by_membership_id: Uuid;
}

export interface ClassTeachersTable extends TenantOwned, ImmutableTimestamp {
  class_id: Uuid;
  teacher_profile_id: Uuid;
  role: ClassTeacherRole;
  joined_at: DbTimestamp;
  left_at: NullableTimestamp;
}

export interface ClassStudentsTable extends TenantOwned, ImmutableTimestamp {
  class_id: Uuid;
  student_profile_id: Uuid;
  joined_at: DbTimestamp;
  left_at: NullableTimestamp;
}

export interface StudentExamGoalsTable extends TenantOwned, MutableTimestamps {
  student_profile_id: Uuid;
  exam_id: Uuid;
  target_score: string | null;
  target_components: JsonColumn;
  target_date: NullableDate;
  is_primary: boolean;
  status: GoalStatus;
}

export interface StableCatalogTable extends TenantOwned, MutableTimestamps {
  slug: string;
  status: CatalogEntityStatus;
  current_published_version_id: Uuid | null;
  created_by_membership_id: Uuid;
}

export interface ContentsTable extends StableCatalogTable {
  kind: ContentKind;
}

export interface ContentVersionsTable extends TenantOwned, MutableTimestamps {
  content_id: Uuid;
  version_no: number;
  publication_state: PublicationState;
  title: string;
  locale: string;
  body: JsonColumn;
  metadata: JsonColumn;
  content_hash: string | null;
  source_platform_content_version_id: Uuid | null;
  published_at: NullableTimestamp;
  published_by_membership_id: Uuid | null;
}

export interface QuestionsTable extends StableCatalogTable {
  kind: QuestionKind;
}

export interface QuestionVersionsTable extends TenantOwned, MutableTimestamps {
  question_id: Uuid;
  version_no: number;
  publication_state: PublicationState;
  prompt: JsonColumn;
  options: NullableJsonColumn;
  answer_key: NullableJsonColumn;
  scoring_rule: JsonColumn;
  max_score: string;
  content_hash: string | null;
  source_platform_question_version_id: Uuid | null;
  published_at: NullableTimestamp;
  published_by_membership_id: Uuid | null;
}

export interface ContentVersionItemsTable extends TenantOwned, ImmutableTimestamp {
  content_version_id: Uuid;
  question_version_id: Uuid;
  section_key: string | null;
  position: number;
  points: string;
  settings: JsonColumn;
}

export interface TasksTable extends StableCatalogTable {}

export interface TaskVersionsTable extends TenantOwned, MutableTimestamps {
  task_id: Uuid;
  version_no: number;
  publication_state: PublicationState;
  task_kind: TaskKind;
  title: string;
  instructions: JsonColumn;
  content_version_id: Uuid;
  completion_rule: JsonColumn;
  grading_policy: JsonColumn;
  estimated_minutes: number | null;
  content_hash: string | null;
  source_platform_task_version_id: Uuid | null;
  published_at: NullableTimestamp;
  published_by_membership_id: Uuid | null;
}

export interface LearningPathsTable extends StableCatalogTable {
  track: LearningTrack;
  exam_id: Uuid | null;
}

export interface LearningPathVersionsTable extends TenantOwned, MutableTimestamps {
  learning_path_id: Uuid;
  version_no: number;
  publication_state: PublicationState;
  title: string;
  description: string | null;
  completion_rule: JsonColumn;
  content_hash: string | null;
  source_platform_learning_path_version_id: Uuid | null;
  published_at: NullableTimestamp;
  published_by_membership_id: Uuid | null;
}

export interface PathNodesTable extends TenantOwned, ImmutableTimestamp {
  learning_path_version_id: Uuid;
  node_key: string;
  task_version_id: Uuid;
  position: number;
  slot_key_template: string;
  available_offset_days: number;
  due_offset_days: number | null;
  close_offset_days: number | null;
  is_required: boolean;
  unlock_rule: JsonColumn;
}

export interface PathPrerequisitesTable extends TenantOwned, ImmutableTimestamp {
  learning_path_version_id: Uuid;
  path_node_id: Uuid;
  prerequisite_node_id: Uuid;
  condition: PrerequisiteCondition;
  threshold: string | null;
}

export interface StudentPathEnrollmentsTable extends TenantOwned, MutableTimestamps {
  student_profile_id: Uuid;
  learning_path_version_id: Uuid;
  student_exam_goal_id: Uuid | null;
  source: EnrollmentSource;
  status: EnrollmentStatus;
  enrolled_at: DbTimestamp;
  target_completion_date: NullableDate;
  paused_at: NullableTimestamp;
  completed_at: NullableTimestamp;
  cancelled_at: NullableTimestamp;
  assigned_by_membership_id: Uuid | null;
}

export interface TaskAssignmentsTable extends TenantOwned, MutableTimestamps {
  task_version_id: Uuid;
  source_type: AssignmentSource;
  occurrence_key: string;
  slot_key: string;
  explicit_priority: number;
  schedule_mode: AssignmentScheduleMode;
  available_at: NullableTimestamp;
  due_at: NullableTimestamp;
  close_at: NullableTimestamp;
  max_attempts: number;
  late_policy: LatePolicy;
  status: AssignmentStatus;
  published_at: NullableTimestamp;
  cancelled_at: NullableTimestamp;
  created_by_membership_id: Uuid;
}

export interface TaskAssignmentStudentTargetsTable extends TenantOwned, ImmutableTimestamp {
  task_assignment_id: Uuid;
  student_profile_id: Uuid;
}

export interface TaskAssignmentClassTargetsTable extends TenantOwned, ImmutableTimestamp {
  task_assignment_id: Uuid;
  class_id: Uuid;
}

export interface TaskAssignmentPathTargetsTable extends TenantOwned, ImmutableTimestamp {
  task_assignment_id: Uuid;
  path_node_id: Uuid;
  learning_path_version_id: Uuid;
}

export interface StudentTaskItemsTable extends TenantOwned, MutableTimestamps {
  student_profile_id: Uuid;
  task_version_id: Uuid;
  occurrence_key: string;
  slot_key: string;
  winning_source_id: Uuid | null;
  resolution_state: ResolutionState;
  resolution_reason: ResolutionReason;
  workflow_state: WorkflowState;
  available_at: DbTimestamp;
  due_at: NullableTimestamp;
  close_at: NullableTimestamp;
  resolution_revision: DbBigInt;
  resolved_at: DbTimestamp;
}

export interface StudentTaskSourcesTable extends TenantOwned, ImmutableTimestamp {
  student_task_item_id: Uuid;
  student_profile_id: Uuid;
  task_assignment_id: Uuid;
  student_target_id: Uuid | null;
  class_target_id: Uuid | null;
  path_target_id: Uuid | null;
  class_id: Uuid | null;
  learning_path_version_id: Uuid | null;
  class_student_id: Uuid | null;
  student_path_enrollment_id: Uuid | null;
  source_type: AssignmentSource;
  source_weight: number;
  explicit_priority: number;
  published_at: DbTimestamp;
  occurrence_key: string;
  slot_key: string;
  available_at: DbTimestamp;
  due_at: NullableTimestamp;
  close_at: NullableTimestamp;
  inactive_at: NullableTimestamp;
  inactive_reason: string | null;
}

export interface StudentTaskOverridesTable extends TenantOwned, ImmutableTimestamp {
  student_task_item_id: Uuid;
  action: OverrideAction;
  replacement_task_version_id: Uuid | null;
  available_at: NullableTimestamp;
  due_at: NullableTimestamp;
  close_at: NullableTimestamp;
  reverses_override_id: Uuid | null;
  reason: string;
  metadata: JsonColumn;
  created_by_membership_id: Uuid;
}

export interface TaskAttemptsTable extends TenantOwned, MutableTimestamps {
  student_task_item_id: Uuid;
  attempt_no: number;
  state: AttemptState;
  snapshot_hash: string;
  started_at: DbTimestamp;
  last_submitted_at: NullableTimestamp;
  completed_at: NullableTimestamp;
  returned_at: NullableTimestamp;
}

export interface AttemptItemSnapshotsTable extends TenantOwned, ImmutableTimestamp {
  task_attempt_id: Uuid;
  position: number;
  content_version_item_id: Uuid;
  question_version_id: Uuid;
  prompt_snapshot: JsonColumn;
  options_snapshot: NullableJsonColumn;
  option_order: NullableJsonColumn;
  answer_key_snapshot: NullableJsonColumn;
  scoring_rule_snapshot: JsonColumn;
  max_score: string;
  snapshot_hash: string;
}

export interface AttemptDraftsTable extends TenantOwned {
  task_attempt_id: Uuid;
  revision: DbBigInt;
  etag: string;
  responses: JsonColumn;
  saved_at: DbTimestamp;
  updated_at: UpdatedAt;
}

export interface SubmissionSnapshotsTable extends TenantOwned, ImmutableTimestamp {
  task_attempt_id: Uuid;
  submission_revision: number;
  previous_submission_snapshot_id: Uuid | null;
  draft_revision: DbBigInt;
  responses: JsonColumn;
  submitted_at: DbTimestamp;
  client_submitted_at: NullableTimestamp;
  is_late: boolean;
  snapshot_hash: string;
}

export interface ScoreDecisionsTable extends TenantOwned, ImmutableTimestamp {
  task_attempt_id: Uuid;
  submission_snapshot_id: Uuid;
  decision_type: ScoreDecisionType;
  score: string;
  max_score: string;
  component_scores: JsonColumn;
  rubric_result: JsonColumn;
  supersedes_score_decision_id: Uuid | null;
  decided_by_membership_id: Uuid | null;
  reason: string | null;
}

export interface FeedbackTable extends TenantOwned, ImmutableTimestamp {
  task_attempt_id: Uuid;
  submission_snapshot_id: Uuid;
  score_decision_id: Uuid | null;
  feedback_type: FeedbackType;
  visibility: FeedbackVisibility;
  body: JsonColumn;
  supersedes_feedback_id: Uuid | null;
  authored_by_membership_id: Uuid | null;
}

export interface FileObjectsTable extends TenantOwned, MutableTimestamps {
  storage_key: string;
  category: FileCategory;
  media_type: string;
  size_bytes: DbBigInt;
  sha256: string;
  status: FileStatus;
  created_by_membership_id: Uuid;
}

export interface ResourceFileLinkTable extends TenantOwned, ImmutableTimestamp {
  file_object_id: Uuid;
  usage: string;
  position: number;
}

export interface ContentVersionFilesTable extends ResourceFileLinkTable {
  content_version_id: Uuid;
}

export interface QuestionVersionFilesTable extends ResourceFileLinkTable {
  question_version_id: Uuid;
}

export interface FeedbackFilesTable extends ResourceFileLinkTable {
  feedback_id: Uuid;
}

export interface ProgressProjectionsTable extends TenantOwned {
  student_profile_id: Uuid;
  projection_type: ProjectionType;
  projection_key: string;
  metrics: JsonColumn;
  source_event_cursor: Uuid;
  as_of: DbTimestamp;
  updated_at: UpdatedAt;
}

export interface OutboxEventsTable extends TenantOwned, ImmutableTimestamp {
  aggregate_type: string;
  aggregate_id: Uuid;
  event_type: string;
  payload: JsonColumn;
  status: OutboxStatus;
  occurred_at: DbTimestamp;
  available_at: DbTimestamp;
  attempt_count: number;
  locked_by: string | null;
  locked_at: NullableTimestamp;
  published_at: NullableTimestamp;
  last_error_code: string | null;
}

export interface WorkerEventReceiptsTable extends TenantOwned, ImmutableTimestamp {
  event_id: Uuid;
  consumer_name: string;
  processed_at: DbTimestamp;
}

export interface IdempotencyRecordsTable extends TenantOwned, MutableTimestamps {
  membership_id: Uuid;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  status: IdempotencyStatus;
  response_status: number | null;
  response_headers: NullableJsonColumn;
  response_body: NullableJsonColumn;
  locked_until: DbTimestamp;
  expires_at: DbTimestamp;
}

export interface AuditLogsTable extends TenantOwned, ImmutableTimestamp {
  actor_user_id: Uuid | null;
  actor_membership_id: Uuid | null;
  actor_type: AuditActorType;
  action: string;
  resource_type: string;
  resource_id: Uuid | null;
  before_hash: string | null;
  after_hash: string | null;
  details: JsonColumn;
  correlation_id: Uuid;
  request_id: Uuid;
  ip_hash: string | null;
}

export interface PlatformExamsTable {
  id: Generated<Uuid>;
  code: string;
  name: string;
  score_schema: JsonColumn;
  status: 'draft' | 'published' | 'retired';
  published_at: NullableTimestamp;
  created_at: CreatedAt;
}

export interface PlatformStableCatalogTable {
  id: Generated<Uuid>;
  slug: string;
  status: CatalogEntityStatus;
  current_published_version_id: Uuid | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PlatformContentsTable extends PlatformStableCatalogTable {
  kind: ContentKind;
}

export interface PlatformContentVersionsTable {
  id: Generated<Uuid>;
  content_id: Uuid;
  version_no: number;
  publication_state: PublicationState;
  title: string;
  locale: string;
  body: JsonColumn;
  metadata: JsonColumn;
  content_hash: string;
  published_at: DbTimestamp;
  created_at: CreatedAt;
}

export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  tenant_memberships: TenantMembershipsTable;
  membership_roles: MembershipRolesTable;
  membership_role_assignments: MembershipRoleAssignmentsTable;
  auth_sessions: AuthSessionsTable;
  student_profiles: StudentProfilesTable;
  teacher_profiles: TeacherProfilesTable;
  student_teacher_links: StudentTeacherLinksTable;
  classes: ClassesTable;
  class_teachers: ClassTeachersTable;
  class_students: ClassStudentsTable;
  student_exam_goals: StudentExamGoalsTable;
  contents: ContentsTable;
  content_versions: ContentVersionsTable;
  questions: QuestionsTable;
  question_versions: QuestionVersionsTable;
  content_version_items: ContentVersionItemsTable;
  tasks: TasksTable;
  task_versions: TaskVersionsTable;
  learning_paths: LearningPathsTable;
  learning_path_versions: LearningPathVersionsTable;
  path_nodes: PathNodesTable;
  path_prerequisites: PathPrerequisitesTable;
  student_path_enrollments: StudentPathEnrollmentsTable;
  task_assignments: TaskAssignmentsTable;
  task_assignment_student_targets: TaskAssignmentStudentTargetsTable;
  task_assignment_class_targets: TaskAssignmentClassTargetsTable;
  task_assignment_path_targets: TaskAssignmentPathTargetsTable;
  student_task_items: StudentTaskItemsTable;
  student_task_sources: StudentTaskSourcesTable;
  student_task_overrides: StudentTaskOverridesTable;
  task_attempts: TaskAttemptsTable;
  attempt_item_snapshots: AttemptItemSnapshotsTable;
  attempt_drafts: AttemptDraftsTable;
  submission_snapshots: SubmissionSnapshotsTable;
  score_decisions: ScoreDecisionsTable;
  effective_score_decisions: ScoreDecisionsTable;
  feedback: FeedbackTable;
  file_objects: FileObjectsTable;
  content_version_files: ContentVersionFilesTable;
  question_version_files: QuestionVersionFilesTable;
  feedback_files: FeedbackFilesTable;
  progress_projections: ProgressProjectionsTable;
  outbox_events: OutboxEventsTable;
  worker_event_receipts: WorkerEventReceiptsTable;
  idempotency_records: IdempotencyRecordsTable;
  audit_logs: AuditLogsTable;
  'platform.exams': PlatformExamsTable;
  'platform.contents': PlatformContentsTable;
  'platform.content_versions': PlatformContentVersionsTable;
}
