import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

class ApiClient {
  cookies = new Map();
  csrfToken = '';

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookies.size) {
      headers.set(
        'cookie',
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.mutate) {
      headers.set('x-csrf-token', this.csrfToken);
      headers.set('origin', webOrigin);
      headers.set('sec-fetch-site', 'same-site');
    }
    const response = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (options.expect !== undefined) {
      assert.equal(response.status, options.expect, `${options.method ?? 'GET'} ${path}: ${text}`);
    } else if (!response.ok) {
      throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
    }
    return { response, body };
  }

  async login(email, password = 'Demo123!') {
    const csrf = await this.request('/api/v1/auth/csrf');
    this.csrfToken = csrf.body.token;
    return this.request('/api/v1/auth/login', {
      method: 'POST',
      mutate: true,
      body: { email, password },
    });
  }
}

function idempotencyHeaders(key = randomUUID()) {
  return { 'idempotency-key': key };
}

async function tenantFor(client) {
  const { body } = await client.request('/api/v1/me/tenants');
  assert.equal(body.data.length, 1);
  return body.data[0];
}

async function taskDetail(client, tenantId, item) {
  return (await client.request(`/api/v1/tenants/${tenantId}/student/task-items/${item.id}`)).body;
}

async function ensureAttempt(client, tenantId, item) {
  let detail = await taskDetail(client, tenantId, item);
  if (!detail.currentAttempt) {
    const started = await client.request(
      `/api/v1/tenants/${tenantId}/student/task-items/${item.id}/attempts`,
      {
        method: 'POST',
        mutate: true,
        headers: idempotencyHeaders(),
        body: { intent: 'start', clientStartedAt: new Date().toISOString() },
        expect: 201,
      },
    );
    assert.equal(started.body.attemptNumber, 1);
    detail = await taskDetail(client, tenantId, item);
  }
  return { detail, attemptId: detail.currentAttempt.id };
}

async function saveAndSubmit(
  client,
  tenantId,
  detail,
  attemptId,
  answer,
  expectedSubmissionRevision,
) {
  const attemptPath = `/api/v1/tenants/${tenantId}/student/attempts/${attemptId}`;
  const current = await client.request(attemptPath);
  const oldEtag = current.response.headers.get('etag');
  const baseRevision = Number(current.body.attempt.revision);
  assert.ok(oldEtag);
  const questionVersionId = detail.taskSnapshot.questions[0].questionVersionId;
  const saved = await client.request(`${attemptPath}/draft`, {
    method: 'PATCH',
    mutate: true,
    headers: { 'if-match': oldEtag },
    body: { baseRevision, answers: [{ questionVersionId, value: answer }] },
  });
  const newEtag = saved.response.headers.get('etag');
  assert.ok(newEtag && newEtag !== oldEtag);

  await client.request(`${attemptPath}/draft`, {
    method: 'PATCH',
    mutate: true,
    headers: { 'if-match': oldEtag },
    body: { baseRevision, answers: [{ questionVersionId, value: answer }] },
    expect: 412,
  });

  const key = randomUUID();
  const submitOptions = {
    method: 'POST',
    mutate: true,
    headers: { ...idempotencyHeaders(key), 'if-match': newEtag },
    body: {
      baseRevision: Number(saved.body.revision),
      clientSubmittedAt: new Date().toISOString(),
    },
  };
  const concurrentSubmissions = await Promise.allSettled([
    client.request(`${attemptPath}/submit`, submitOptions),
    client.request(`${attemptPath}/submit`, submitOptions),
  ]);
  const successfulSubmissions = concurrentSubmissions.filter(
    (result) => result.status === 'fulfilled',
  );
  assert.ok(successfulSubmissions.length >= 1);
  for (const rejected of concurrentSubmissions.filter((result) => result.status === 'rejected')) {
    assert.match(String(rejected.reason), /409/);
  }
  const submitted = successfulSubmissions[0].value;
  assert.equal(submitted.body.attemptId, attemptId);
  assert.equal(submitted.body.submissionRevision, expectedSubmissionRevision);
  const replayed = await client.request(`${attemptPath}/submit`, submitOptions);
  assert.deepEqual(replayed.body, submitted.body);
  assert.equal(replayed.response.headers.get('idempotency-replayed'), 'true');
  return submitted.body;
}

async function waitForAttempt(client, tenantId, attemptId, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.request(
      `/api/v1/tenants/${tenantId}/student/attempts/${attemptId}`,
    );
    if (expected.includes(result.body.attempt.state)) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Attempt ${attemptId} did not reach ${expected.join('/')}`);
}

async function waitForTaskResolution(client, tenantId, taskItemId, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = await taskDetail(client, tenantId, { id: taskItemId });
    if (detail.item.resolutionState === expected) return detail;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Task ${taskItemId} did not reach resolution ${expected}`);
}

async function waitForTaskOccurrence(client, tenantId, occurrenceKey, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.request(`/api/v1/tenants/${tenantId}/student/task-items`);
    const item = result.body.data.find((candidate) => candidate.occurrenceKey === occurrenceKey);
    if (item) return item;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Task occurrence ${occurrenceKey} was not materialized`);
}

const student = new ApiClient();
await student.login('student@example.test');
const studentTenant = await tenantFor(student);
const tenantId = studentTenant.tenant.id;
assert.deepEqual(studentTenant.roles, ['student']);

const missingCsrf = new ApiClient();
await missingCsrf.request('/api/v1/auth/csrf');
await missingCsrf.request('/api/v1/auth/login', {
  method: 'POST',
  body: { email: 'student@example.test', password: 'Demo123!' },
  expect: 403,
});

const itemsResult = await student.request(`/api/v1/tenants/${tenantId}/student/task-items`);
assert.equal(itemsResult.body.data.length, 3);
const firstTaskPage = await student.request(
  `/api/v1/tenants/${tenantId}/student/task-items?pageSize=1`,
);
assert.equal(firstTaskPage.body.data.length, 1);
assert.equal(firstTaskPage.body.page.hasMore, true);
assert.ok(firstTaskPage.body.page.nextCursor);
const secondTaskPage = await student.request(
  `/api/v1/tenants/${tenantId}/student/task-items?pageSize=1&cursor=${encodeURIComponent(firstTaskPage.body.page.nextCursor)}`,
);
assert.equal(secondTaskPage.body.data.length, 1);
assert.notEqual(secondTaskPage.body.data[0].id, firstTaskPage.body.data[0].id);
await student.request(`/api/v1/tenants/${tenantId}/student/task-items?cursor=invalid`, {
  expect: 400,
});
const notStartedTasks = await student.request(
  `/api/v1/tenants/${tenantId}/student/task-items?workflowState=not_started`,
);
assert.equal(notStartedTasks.body.data.length, 3);
const studentPaths = await student.request(`/api/v1/tenants/${tenantId}/student/learning-paths`);
assert.equal(studentPaths.body.data.length, 2);
const objective = itemsResult.body.data.find((item) => item.kind !== 'writing');
const writing = itemsResult.body.data.find((item) => item.kind === 'writing');
assert.ok(objective && writing);
const remainingUnstarted = itemsResult.body.data.find(
  (item) => item.id !== objective.id && item.id !== writing.id,
);
assert.ok(remainingUnstarted);

await student.request(`/api/v1/tenants/00000000-0000-4000-8000-000000000099/student/task-items`, {
  expect: 404,
});
await student.request(`/api/v1/tenants/${tenantId}/admin/memberships`, { expect: 403 });

const objectiveAttempt = await ensureAttempt(student, tenantId, objective);
const objectiveQuestionVersionId =
  objectiveAttempt.detail.taskSnapshot.questions[0].questionVersionId;
const objectiveSnapshotHash = objectiveAttempt.detail.taskSnapshot.contentHash;
const objectiveReceipt = await saveAndSubmit(
  student,
  tenantId,
  objectiveAttempt.detail,
  objectiveAttempt.attemptId,
  'b',
  1,
);
await waitForAttempt(student, tenantId, objectiveReceipt.attemptId, ['completed']);

const writingAttempt = await ensureAttempt(student, tenantId, writing);
const writingReceipt = await saveAndSubmit(
  student,
  tenantId,
  writingAttempt.detail,
  writingAttempt.attemptId,
  'Working in groups is effective because learners explain ideas and receive immediate feedback.',
  1,
);
await waitForAttempt(student, tenantId, writingReceipt.attemptId, ['grading']);

const teacher = new ApiClient();
await teacher.login('teacher@example.test');
const teacherTenant = await tenantFor(teacher);
assert.equal(teacherTenant.tenant.id, tenantId);
const teacherClasses = await teacher.request(`/api/v1/tenants/${tenantId}/teacher/classes`);
const teacherStudents = await teacher.request(`/api/v1/tenants/${tenantId}/teacher/students`);
const seededClass = teacherClasses.body.data[0];
const seededStudent = teacherStudents.body.data.find(
  (candidate) => candidate.membershipId === studentTenant.membershipId,
);
assert.ok(seededClass && seededStudent);
await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}/students/${seededStudent.membershipId}`,
  { method: 'DELETE', mutate: true, expect: 204 },
);
await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}/students/${seededStudent.membershipId}`,
  { method: 'PUT', mutate: true, expect: 204 },
);
const restoredClass = await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}`,
);
assert.ok(
  restoredClass.body.students.some(
    (candidate) => candidate.membershipId === seededStudent.membershipId,
  ),
);
const assignmentOccurrence = `e2e:individual:${randomUUID()}`;
const assignmentSlot = `e2e:slot:${randomUUID()}`;
const createdAssignment = await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/task-assignments`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      taskVersionId: objective.taskVersionId,
      sourceType: 'individual',
      occurrenceKey: assignmentOccurrence,
      slotKey: assignmentSlot,
      explicitPriority: 0,
      scheduleMode: 'absolute',
      availableAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      closeAt: null,
      maxAttempts: 2,
      latePolicy: 'allow',
      targets: {
        studentMembershipIds: [studentTenant.membershipId],
        classIds: [],
        pathNodeIds: [],
      },
    },
    expect: 201,
  },
);
await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/task-assignments/${createdAssignment.body.id}/publish`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    expect: 202,
  },
);
const asynchronouslyMaterialized = await waitForTaskOccurrence(
  student,
  tenantId,
  assignmentOccurrence,
);
const concurrentStartPath = `/api/v1/tenants/${tenantId}/student/task-items/${asynchronouslyMaterialized.id}/attempts`;
const concurrentStarts = await Promise.allSettled(
  [randomUUID(), randomUUID()].map((key) =>
    student.request(concurrentStartPath, {
      method: 'POST',
      mutate: true,
      headers: idempotencyHeaders(key),
      body: { intent: 'start', clientStartedAt: new Date().toISOString() },
    }),
  ),
);
const successfulStarts = concurrentStarts.filter((result) => result.status === 'fulfilled');
const rejectedStarts = concurrentStarts.filter((result) => result.status === 'rejected');
assert.equal(successfulStarts.length, 1);
assert.equal(rejectedStarts.length, 1);
assert.match(String(rejectedStarts[0].reason), /409/);
const concurrentAttemptId = successfulStarts[0].value.body.id;
const hiddenOverride = await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/task-items/${asynchronouslyMaterialized.id}/overrides`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: { action: 'hide', reason: '端到端验证隐藏。' },
    expect: 201,
  },
);
assert.equal(hiddenOverride.body.resultingResolutionState, 'hidden');
const restoredOverride = await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/task-items/${asynchronouslyMaterialized.id}/overrides`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      action: 'restore',
      reversesOverrideId: hiddenOverride.body.id,
      reason: '端到端验证恢复。',
    },
    expect: 201,
  },
);
assert.equal(restoredOverride.body.resultingResolutionState, 'active');
await teacher.request(
  `/api/v1/tenants/${tenantId}/teacher/task-assignments/${createdAssignment.body.id}/cancel`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: { reason: '端到端验证取消后来源失活。' },
    expect: 202,
  },
);
await waitForTaskResolution(student, tenantId, asynchronouslyMaterialized.id, 'hidden');
const cancelledAssignmentHistory = await taskDetail(student, tenantId, asynchronouslyMaterialized);
assert.equal(cancelledAssignmentHistory.currentAttempt.id, concurrentAttemptId);
const teacherBase = `/api/v1/tenants/${tenantId}/teacher/attempts/${writingReceipt.attemptId}`;
const gradingReview = await teacher.request(teacherBase);
assert.equal(gradingReview.body.submission.id, writingReceipt.submissionSnapshotId);
assert.equal(gradingReview.body.submission.revision, 1);
assert.match(
  JSON.stringify(gradingReview.body.submission.responses),
  /Working in groups is effective/,
);
assert.equal(JSON.stringify(gradingReview.body.questions).includes('answerKey'), false);
assert.equal(JSON.stringify(gradingReview.body.questions).includes('correct_option_ids'), false);
const ownerGrader = new ApiClient();
await ownerGrader.login('owner@example.test');
const ownerTenant = await tenantFor(ownerGrader);
await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/admin/memberships/${ownerTenant.membershipId}`,
  {
    method: 'PATCH',
    mutate: true,
    body: { roles: ['owner', 'teacher'] },
  },
);
const contentCatalog = await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/admin/contents?ownership=platform`,
);
const officialContent = contentCatalog.body.data.find((item) => item.ownership === 'platform');
assert.ok(officialContent?.latestPublishedVersionId);
const clonedContent = await ownerGrader.request(`/api/v1/tenants/${tenantId}/admin/contents`, {
  method: 'POST',
  mutate: true,
  headers: idempotencyHeaders(),
  body: {
    slug: `official-feedback-${randomUUID()}`,
    cloneFromPlatformVersionId: officialContent.latestPublishedVersionId,
  },
  expect: 201,
});
assert.equal(clonedContent.body.ownership, 'tenant');
const clonedContentDetail = await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/admin/contents/${clonedContent.body.id}`,
);
assert.equal(clonedContentDetail.body.versions[0].publicationState, 'draft');
const sourceQuestionByVersion = {
  '0194a000-0000-7000-8000-000000001011': '0194a000-0000-7000-8000-000000001001',
  '0194a000-0000-7000-8000-000000001012': '0194a000-0000-7000-8000-000000001002',
};
const objectiveQuestionId = sourceQuestionByVersion[objectiveQuestionVersionId];
assert.ok(objectiveQuestionId);
const updatedQuestionVersion = await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/admin/questions/${objectiveQuestionId}/versions`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      prompt: { format: 'plain', text: 'A newly published prompt must not alter old attempts.' },
      options: [
        { option_id: 'a', text: 'Old snapshots change.' },
        { option_id: 'b', text: 'Old snapshots remain immutable.' },
      ],
      answerKey: { correct_option_ids: ['b'] },
      scoringRule: { type: 'exact_option_set', points: 1 },
      maxScore: 1,
    },
    expect: 201,
  },
);
await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/admin/question-versions/${updatedQuestionVersion.body.id}/publish`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
  },
);
const historicalObjective = await taskDetail(student, tenantId, objective);
assert.equal(
  historicalObjective.taskSnapshot.questions[0].questionVersionId,
  objectiveQuestionVersionId,
);
assert.equal(historicalObjective.taskSnapshot.contentHash, objectiveSnapshotHash);
await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}/teachers/${ownerTenant.membershipId}`,
  { method: 'PUT', mutate: true, expect: 204 },
);
const multiTeacherClass = await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}`,
);
assert.equal(multiTeacherClass.body.teachers.length, 2);
const invitedEmail = `new.student.${randomUUID()}@example.test`;
const invited = await ownerGrader.request(`/api/v1/tenants/${tenantId}/admin/memberships`, {
  method: 'POST',
  mutate: true,
  headers: idempotencyHeaders(),
  body: { email: invitedEmail, displayName: '新加入学生', roles: ['student'] },
  expect: 201,
});
await ownerGrader.request(`/api/v1/tenants/${tenantId}/admin/memberships/${invited.body.id}`, {
  method: 'PATCH',
  mutate: true,
  body: { status: 'active' },
});
const joinedStudents = await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/teacher/students?query=${encodeURIComponent('新加入学生')}`,
);
assert.ok(joinedStudents.body.data.some((candidate) => candidate.membershipId === invited.body.id));
await ownerGrader.request(
  `/api/v1/tenants/${tenantId}/teacher/classes/${seededClass.id}/students/${invited.body.id}`,
  { method: 'PUT', mutate: true, expect: 204 },
);
const [teacherGrade, ownerGrade] = await Promise.all([
  teacher.request(`${teacherBase}/grades`, {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      submissionSnapshotId: writingReceipt.submissionSnapshotId,
      score: 24,
      maxScore: 30,
      feedback: '论点清楚，请补充段落之间的衔接。',
      rubricScores: [
        { criterionKey: 'organization', score: 4, maxScore: 5, comment: '结构完整。' },
      ],
    },
    expect: 201,
  }),
  ownerGrader.request(`${teacherBase}/grades`, {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      submissionSnapshotId: writingReceipt.submissionSnapshotId,
      score: 25,
      maxScore: 30,
      feedback: '管理员复核：评分有效。',
      rubricScores: [
        { criterionKey: 'organization', score: 4.5, maxScore: 5, comment: '复核通过。' },
      ],
    },
    expect: 201,
  }),
]);
assert.equal(teacherGrade.body.attemptId, writingReceipt.attemptId);
assert.equal(ownerGrade.body.attemptId, writingReceipt.attemptId);

const returned = await teacher.request(`${teacherBase}/return`, {
  method: 'POST',
  mutate: true,
  headers: idempotencyHeaders(),
  body: {
    submissionSnapshotId: writingReceipt.submissionSnapshotId,
    message: '请补充一个具体例子后重新提交。',
  },
});
assert.equal(returned.body.id, writingReceipt.attemptId);
assert.equal(returned.body.attemptNumber, 1);
assert.equal(returned.body.state, 'returned');

const writingDetailAgain = await taskDetail(student, tenantId, writing);
const resubmitted = await saveAndSubmit(
  student,
  tenantId,
  writingDetailAgain,
  writingReceipt.attemptId,
  'Working in groups is effective. For example, peer explanations helped me revise a weak thesis.',
  2,
);
assert.equal(resubmitted.attemptId, writingReceipt.attemptId);

const uploadBytes = Buffer.from('term,definition\nfeedback,information that improves later work\n');
const uploadSha256 = createHash('sha256').update(uploadBytes).digest('hex');
const uploadIdempotencyKey = randomUUID();
const uploadReservation = await student.request(
  `/api/v1/tenants/${tenantId}/files/presigned-uploads`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(uploadIdempotencyKey),
    body: {
      purpose: 'submission_attachment',
      fileName: 'learning-notes.csv',
      contentType: 'text/csv',
      sizeBytes: uploadBytes.length,
      sha256: uploadSha256,
    },
    expect: 201,
  },
);
await student.request(`/api/v1/tenants/${tenantId}/files/presigned-uploads`, {
  method: 'POST',
  mutate: true,
  headers: idempotencyHeaders(uploadIdempotencyKey),
  body: {
    purpose: 'submission_attachment',
    fileName: 'different-learning-notes.csv',
    contentType: 'text/csv',
    sizeBytes: uploadBytes.length,
    sha256: uploadSha256,
  },
  expect: 409,
});
const objectUpload = await fetch(uploadReservation.body.uploadUrl, {
  method: 'PUT',
  headers: uploadReservation.body.requiredHeaders,
  body: uploadBytes,
});
assert.equal(objectUpload.status, 200);
const storageEtag = objectUpload.headers.get('etag');
assert.ok(storageEtag);
const completedFile = await student.request(
  `/api/v1/tenants/${tenantId}/files/${uploadReservation.body.fileId}/complete`,
  {
    method: 'POST',
    mutate: true,
    headers: idempotencyHeaders(),
    body: {
      sizeBytes: uploadBytes.length,
      sha256: uploadSha256,
      storageEtag,
    },
  },
);
assert.equal(completedFile.body.status, 'ready');
assert.equal(completedFile.body.sha256, uploadSha256);

const remainingTrack = remainingUnstarted.kind === 'practice' ? 'general' : 'toefl';
const enrollmentToPause = studentPaths.body.data.find((path) => path.track === remainingTrack);
assert.ok(enrollmentToPause);
const enrollmentPath = `/api/v1/tenants/${tenantId}/teacher/students/${studentTenant.membershipId}/learning-path-enrollments/${enrollmentToPause.id}`;
await teacher.request(enrollmentPath, {
  method: 'PATCH',
  mutate: true,
  body: { status: 'paused', reason: '端到端验证路径暂停。' },
});
await waitForTaskResolution(student, tenantId, remainingUnstarted.id, 'hidden');
const objectiveAfterPause = await taskDetail(student, tenantId, objective);
assert.equal(objectiveAfterPause.currentAttempt.id, objectiveReceipt.attemptId);
await teacher.request(enrollmentPath, {
  method: 'PATCH',
  mutate: true,
  body: { status: 'active', reason: '端到端验证路径恢复。' },
});
await waitForTaskResolution(student, tenantId, remainingUnstarted.id, 'active');

const latestWritingReview = await teacher.request(teacherBase);
assert.equal(latestWritingReview.body.submission.revision, 2);
assert.equal(latestWritingReview.body.grade, null);

const refreshReuseClient = new ApiClient();
await refreshReuseClient.login('owner@example.test');
const oldRefreshToken = refreshReuseClient.cookies.get('refresh_token');
assert.ok(oldRefreshToken);
await refreshReuseClient.request('/api/v1/auth/refresh', {
  method: 'POST',
  mutate: true,
});
assert.notEqual(refreshReuseClient.cookies.get('refresh_token'), oldRefreshToken);
refreshReuseClient.cookies.set('refresh_token', oldRefreshToken);
await refreshReuseClient.request('/api/v1/auth/refresh', {
  method: 'POST',
  mutate: true,
  expect: 401,
});

console.log(
  JSON.stringify(
    {
      status: 'ok',
      tenantId,
      objectiveAttemptId: objectiveReceipt.attemptId,
      writingAttemptId: writingReceipt.attemptId,
      returnedAndResubmittedSameAttempt: resubmitted.attemptId === writingReceipt.attemptId,
      submissionRevision: resubmitted.submissionRevision,
      uploadedFileId: completedFile.body.id,
      uploadedFileStatus: completedFile.body.status,
      csrfRejectedWithoutHeader: true,
      refreshReuseDetected: true,
      concurrentGradersSerialized: true,
      classLeaveAndRejoinPreserved: true,
      assignmentPublishedByWorkerAndCancelled: true,
      taskHideAndRestoreVerified: true,
      concurrentStartSerialized: true,
      assignmentCancellationPreservedAttempt: true,
      immutableSubmissionReadableForTeacher: true,
      multiTeacherClassVerified: true,
      invitedStudentProvisioned: true,
      officialContentCloned: true,
      historicalAttemptSnapshotStable: true,
      pathPauseAndRestorePreservedHistory: true,
      writingAwaitedTeacherWithoutAutoScore: true,
    },
    null,
    2,
  ),
);
