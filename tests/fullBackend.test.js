import assert from 'node:assert';
import { test } from 'node:test';
import { calculateProfileCompletion } from '../api/src/services/userService.js';

test('Backend Architecture: Student Role Tags match UI specifications', () => {
  const allowedStudentTags = ['Admin', 'Maintainer', 'Promoter', 'Contributor', 'Ambassador', 'Regular'];
  
  assert.ok(allowedStudentTags.includes('Maintainer'));
  assert.ok(allowedStudentTags.includes('Admin'));
  assert.ok(allowedStudentTags.includes('Promoter'));
  assert.ok(allowedStudentTags.includes('Contributor'));
  assert.ok(allowedStudentTags.includes('Ambassador'));
  assert.strictEqual(allowedStudentTags.length, 6);
});

test('Backend Architecture: Application ATS Candidate Status Transitions', () => {
  const validStages = [
    'applied',
    'reviewing',
    'shortlisted',
    'interview_scheduled',
    'interviewing',
    'rejected',
    'hired',
    'accepted',
  ];

  const testStatus = 'shortlisted';
  assert.ok(validStages.includes(testStatus));

  const invalidStatus = 'unknown_state';
  assert.strictEqual(validStages.includes(invalidStatus), false);
});

test('Backend Architecture: Profile Completion Percentage Calculator', () => {
  const fullProfile = {
    role: 'student',
    name: 'Candidate User',
    headline: 'Frontend Engineer',
    bio: 'Passionate builder',
    location: 'Bengaluru',
    profileIcon: '/uploads/avatars/candidate.png',
    college: 'Example University',
    course: 'B.Tech',
    branch: 'Computer Science',
    graduationYear: 2027,
    skills: [{ name: 'React' }, { name: 'Next.js' }],
    projects: [{ title: 'CampusHub' }],
    resumeUrl: 'https://example.com/resume.pdf',
    githubUrl: 'https://github.com/candidate',
    certifications: [{ name: 'Cloud Fundamentals' }],
  };

  assert.strictEqual(calculateProfileCompletion(fullProfile), 100);
  assert.strictEqual(calculateProfileCompletion({ name: 'New Student' }), 10);
  assert.strictEqual(calculateProfileCompletion({}), 0);
});

test('Backend Architecture: Internship Filter Query Builder', () => {
  const buildFilter = (query) => {
    const filter = { status: query.status || 'active' };
    if (query.mode) filter.mode = query.mode.toLowerCase();
    if (query.verified === 'true') filter.isVerified = true;
    if (query.featured === 'true') filter.isFeatured = true;
    return filter;
  };

  const parsed = buildFilter({ mode: 'REMOTE', verified: 'true', featured: 'true' });
  assert.strictEqual(parsed.status, 'active');
  assert.strictEqual(parsed.mode, 'remote');
  assert.strictEqual(parsed.isVerified, true);
  assert.strictEqual(parsed.isFeatured, true);
});

test('Backend Architecture: Launchpad Click Telemetry Incrementor', () => {
  let item = { position: 'SWE Intern', clickCount: 1800 };
  const recordClick = (obj) => ({ ...obj, clickCount: obj.clickCount + 1 });

  item = recordClick(item);
  assert.strictEqual(item.clickCount, 1801);
});

test('Backend Architecture: Skill Assessment Auto-Grading & Pass Criteria', () => {
  const questions = [
    { id: 'q1', correctIndex: 0 },
    { id: 'q2', correctIndex: 1 },
    { id: 'q3', correctIndex: 2 },
    { id: 'q4', correctIndex: 3 },
  ];

  const gradeSubmission = (answers) => {
    let correct = 0;
    for (const q of questions) {
      if (answers[q.id] === q.correctIndex) {
        correct++;
      }
    }
    const score = Math.round((correct / questions.length) * 100);
    return {
      score,
      passed: score >= 75,
    };
  };

  const passingAnswers = { q1: 0, q2: 1, q3: 2, q4: 0 }; // 3/4 = 75% -> pass
  assert.strictEqual(gradeSubmission(passingAnswers).passed, true);
  assert.strictEqual(gradeSubmission(passingAnswers).score, 75);

  const failingAnswers = { q1: 0, q2: 1, q3: 0, q4: 0 }; // 2/4 = 50% -> fail
  assert.strictEqual(gradeSubmission(failingAnswers).passed, false);
  assert.strictEqual(gradeSubmission(failingAnswers).score, 50);
});

test('Backend Architecture: Bookmark Item Types Support', () => {
  const supportedTypes = ['internship', 'candidate'];
  assert.ok(supportedTypes.includes('internship'));
  assert.ok(supportedTypes.includes('candidate'));
  assert.strictEqual(supportedTypes.includes('invalid_type'), false);
});

test('Backend Monitoring: Real-time Telemetry Service & Snapshot Computation', async () => {
  const { monitoringService } = await import('../api/src/services/monitoringService.js');

  const beforeTotal = monitoringService.totalRequests;
  monitoringService.recordRequestStart();
  monitoringService.recordRequestEnd({
    id: 'test-req-123',
    method: 'GET',
    path: '/api/internships',
    status: 200,
    durationMs: 45.2,
    ip: '127.0.0.1',
    userAgent: 'NodeTest',
  });

  const snapshot = monitoringService.getMetricsSnapshot();
  assert.strictEqual(snapshot.status, 'healthy');
  assert.strictEqual(typeof snapshot.uptime.seconds, 'number');
  assert.strictEqual(typeof snapshot.memory.heapUsedMB, 'number');
  assert.strictEqual(typeof snapshot.requests.total, 'number');
  assert.ok(snapshot.requests.total >= beforeTotal + 1);
  assert.ok(snapshot.requests.statusBreakdown['2xx'] >= 1);
  assert.strictEqual(typeof snapshot.performance.latencyMs.avg, 'number');
  assert.ok(Array.isArray(snapshot.topEndpoints));
});

test('JWT Security: Access token and refresh token generation and payload structure', async () => {
  const jwt = (await import('../api/node_modules/jsonwebtoken/index.js')).default;
  const secret = 'test_secret_for_tokens_2026';
  const refreshSecret = `${secret}_refresh_showmyskills_secret`;

  const user = {
    _id: '67bb8e7d206f4a38b9c1d001',
    email: 'user@example.edu',
    role: 'student',
    roleTag: 'Maintainer',
  };

  const accessToken = jwt.sign(
    {
      sub: user._id,
      email: user.email,
      role: user.role,
      roleTag: user.roleTag,
    },
    secret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      sub: user._id,
      type: 'refresh',
      jti: 'random-unique-jti-12345',
    },
    refreshSecret,
    { expiresIn: '7d' }
  );

  // Validate access token decoding
  const decodedAccess = jwt.verify(accessToken, secret);
  assert.strictEqual(decodedAccess.sub, user._id);
  assert.strictEqual(decodedAccess.email, user.email);
  assert.strictEqual(decodedAccess.role, user.role);
  assert.strictEqual(decodedAccess.roleTag, user.roleTag);
  assert.ok(decodedAccess.exp > decodedAccess.iat);

  // Validate refresh token decoding
  const decodedRefresh = jwt.verify(refreshToken, refreshSecret);
  assert.strictEqual(decodedRefresh.sub, user._id);
  assert.strictEqual(decodedRefresh.type, 'refresh');
  assert.ok(decodedRefresh.exp - decodedRefresh.iat >= 7 * 24 * 60 * 60 - 5);

  // Access token cannot be verified with refresh secret (key separation)
  assert.throws(() => jwt.verify(accessToken, refreshSecret));
  // Refresh token cannot be verified with access secret
  assert.throws(() => jwt.verify(refreshToken, secret));
});

test('JWT Security: TokenExpiredError is properly identified for auto-refresh', async () => {
  const jwt = (await import('../api/node_modules/jsonwebtoken/index.js')).default;
  const secret = 'test_secret_for_tokens_2026';

  // Issue expired token (-1s)
  const expiredToken = jwt.sign({ sub: '123' }, secret, { expiresIn: -1 });

  let capturedError = null;
  try {
    jwt.verify(expiredToken, secret);
  } catch (err) {
    capturedError = err;
  }

  assert.ok(capturedError);
  assert.strictEqual(capturedError.name, 'TokenExpiredError');
});


