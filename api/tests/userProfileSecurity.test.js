import assert from 'node:assert/strict';
import { test } from 'node:test';
import User from '../src/models/User.js';
import { sanitizeDirectoryUser, userService } from '../src/services/userService.js';
import { authController } from '../src/controllers/authController.js';
import { userController } from '../src/controllers/userController.js';
import { calculateProfileCompletion } from '../src/services/userService.js';
import userRoutes from '../src/routes/userRoutes.js';
import { authMiddleware } from '../src/middleware/authMiddleware.js';

const storedUser = {
  _id: 'user-123',
  name: 'Student Example',
  email: 'student@example.com',
  phone: '555-0100',
  role: 'student',
  headline: 'Developer',
  profileIcon: '/uploads/avatars/student.png',
  resumeUrl: '/uploads/resumes/student-resume.pdf',
  completionPercentage: 80,
  college: 'Example University',
  skills: [{ name: 'JavaScript' }],
  notificationPreferences: { applicationUpdates: true },
  privacyPreferences: { publicProfile: true },
  password: 'hashed-password',
  refreshTokens: [{ token: 'refresh-secret' }],
  emailVerificationOtp: 'email-otp-secret',
  emailVerificationOtpExpires: new Date(),
  passwordResetOtp: 'reset-otp-secret',
  passwordResetOtpExpires: new Date(),
  twoFactorEnabled: true,
  collegeId: 'private-college-id',
  collegeIdDocument: '/private/id-card.pdf',
  collegeIdVerified: true,
  verificationExpiresAt: new Date(),
};

const withFindByIdProjection = async (run) => {
  const originalFindById = User.findById;
  let selectedFields = '';
  User.findById = () => ({
    select: (fields) => {
      selectedFields = fields;
      const allowed = new Set(fields.split(/\s+/).filter(Boolean));
      return Object.fromEntries(
        Object.entries(storedUser).filter(([key]) => key === '_id' || allowed.has(key))
      );
    },
  });

  try {
    await run(() => selectedFields);
  } finally {
    User.findById = originalFindById;
  }
};

const mockResponse = () => ({
  body: undefined,
  json(body) {
    this.body = body;
    return this;
  },
});

const sensitiveKeys = [
  'password',
  'refreshTokens',
  'emailVerificationOtp',
  'emailVerificationOtpExpires',
  'passwordResetOtp',
  'passwordResetOtpExpires',
  'twoFactorEnabled',
  'collegeId',
  'collegeIdDocument',
  'collegeIdVerified',
  'verificationExpiresAt',
];

test('GET /api/auth/me returns profile data without authentication or security fields', async () => {
  await withFindByIdProjection(async (getSelectedFields) => {
    const res = mockResponse();
    await authController.getMe({ user: { id: storedUser._id } }, res, assert.fail);

    assert.equal(res.body.success, true);
    assert.equal(res.body.data._id, storedUser._id);
    assert.equal(res.body.data.name, storedUser.name);
    assert.equal(res.body.data.email, storedUser.email);
    assert.equal(res.body.data.profileIcon, storedUser.profileIcon);
    assert.equal(res.body.data.resumeUrl, storedUser.resumeUrl);
    assert.equal(res.body.data.completionPercentage, calculateProfileCompletion(storedUser));
    for (const key of sensitiveKeys) assert.equal(key in res.body.data, false, `${key} must be omitted`);

    const selected = getSelectedFields();
    for (const key of sensitiveKeys) {
      assert.equal(selected.split(/\s+/).includes(key), false, `${key} must not be selected`);
    }
  });
});

test('GET /api/users/:id returns only public profile fields', async () => {
  await withFindByIdProjection(async () => {
    const res = mockResponse();
    await userController.getUserById({ params: { id: storedUser._id } }, res, assert.fail);

    assert.equal(res.body.success, true);
    assert.equal(res.body.data._id, storedUser._id);
    assert.equal(res.body.data.name, storedUser.name);
    assert.equal(res.body.data.headline, storedUser.headline);
    assert.equal(res.body.data.skills[0].name, 'JavaScript');
    assert.equal('resumeUrl' in res.body.data, false);
    assert.equal(res.body.data.completionPercentage, calculateProfileCompletion(storedUser));
    for (const key of sensitiveKeys) assert.equal(key in res.body.data, false, `${key} must be omitted`);
    assert.equal('email' in res.body.data, false);
    assert.equal('phone' in res.body.data, false);
    assert.equal('notificationPreferences' in res.body.data, false);
    assert.equal('privacyPreferences' in res.body.data, false);
  });
});

test('public profile sanitizes nested certification, achievement, company, and college data', async () => {
  const originalFindById = User.findById;
  const publicDocument = {
    ...storedUser,
    certifications: [{ name: 'Public certificate', issuingOrganization: 'Org', certificateFile: '/private/cert.pdf', token: 'secret' }],
    achievements: [{ achievement: 'Finalist', year: 2025, proofFile: '/private/proof.pdf', privateNote: 'secret' }],
    companyProfile: {
      companyName: 'Public Co', logo: '/logo.png', aboutCompany: 'About', isVerified: true,
      privateDocument: '/private/company.pdf', refreshTokens: ['secret'],
      awards: [{ name: 'Award', receivedYear: 2024, category: 'Tech', certificateFile: '/private/award.pdf' }],
      certifications: [{ name: 'Quality', issuingBody: 'Board', validationDate: '2025', proofFile: '/private/company-proof.pdf' }],
    },
    collegeProfile: {
      collegeName: 'Public College', aboutCollege: 'About', departments: ['CS', null, 3],
      pincode: '123456', isVerified: true, collegeIdDocument: '/private/id.pdf', password: 'secret',
    },
  };
  User.findById = () => ({ select: async () => ({ ...publicDocument }) });
  try {
    const res = mockResponse();
    await userController.getUserById({ params: { id: storedUser._id } }, res, assert.fail);
    const { data } = res.body;
    assert.deepEqual(data.certifications, [{ name: 'Public certificate', issuingOrganization: 'Org' }]);
    assert.deepEqual(data.achievements, [{ achievement: 'Finalist', year: 2025 }]);
    assert.deepEqual(data.companyProfile, {
      companyName: 'Public Co', logo: '/logo.png', aboutCompany: 'About',
      awards: [{ name: 'Award', receivedYear: 2024, category: 'Tech' }],
      certifications: [{ name: 'Quality', issuingBody: 'Board', validationDate: '2025' }],
    });
    assert.deepEqual(data.collegeProfile, {
      collegeName: 'Public College', aboutCollege: 'About', departments: ['CS'],
    });
    assert.equal('resumeUrl' in data, false);
  } finally {
    User.findById = originalFindById;
  }
});

test('public college profile completion includes stored pincode without returning it', async () => {
  const originalFindById = User.findById;
  let selectedFields = '';
  const completeCollege = {
    _id: 'college-1',
    role: 'college',
    name: 'Example College',
    profileIcon: '/uploads/college.png',
    location: 'Mysuru',
    completionPercentage: 0,
    collegeProfile: {
      collegeName: 'Example College',
      aboutCollege: 'A learning community.',
      establishedYear: 1990,
      collegeType: 'Public',
      pincode: '570001',
      departments: ['Engineering'],
      courses: ['B.Tech'],
      numberOfStudents: 5000,
      website: 'https://college.example',
      linkedin: 'https://linkedin.com/college',
    },
  };
  User.findById = () => ({
    select: async (fields) => {
      selectedFields = fields;
      return { ...completeCollege, collegeProfile: { ...completeCollege.collegeProfile } };
    },
  });

  try {
    const res = mockResponse();
    await userController.getUserById({ params: { id: completeCollege._id } }, res, assert.fail);
    assert.match(selectedFields, /collegeProfile\.pincode/);
    assert.equal(res.body.data.completionPercentage, 100);
    assert.equal('pincode' in res.body.data.collegeProfile, false);
  } finally {
    User.findById = originalFindById;
  }
});

test('GET /api/users directory returns only allowlisted public fields', async () => {
  const originalSearchUsers = userService.searchUsers;
  let searchArguments;
  userService.searchUsers = async (args) => {
    searchArguments = args;
    return ({
    users: [{
      ...storedUser,
      companyProfile: { companyName: 'Public Company', refreshTokens: ['nested-secret'] },
      collegeProfile: { collegeName: 'Public College', password: 'nested-hash' },
      skills: [
        { name: 'JavaScript', level: 'advanced', endorsedCount: 3, password: 'nested-secret', privateNote: 'secret' },
        null,
        'unexpected-entry',
        ['array-entry'],
      ],
      projects: [
        {
          id: 'project-1',
          title: 'Public Project',
          description: 'A public project',
          tags: ['web'],
          verified: true,
          repoUrl: 'https://example.com/repo',
          liveUrl: 'https://example.com/app',
          certificateFile: '/private/file.pdf',
          refreshTokens: ['nested-secret'],
        },
        null,
        12,
      ],
      metrics: [
        { label: 'Projects', value: 4, color: '#123456', proofFile: '/private/proof.pdf', secret: 'x' },
        null,
        'malformed',
      ],
      certifications: [
        {
          name: 'Public Certification',
          issuingOrganization: 'Example Org',
          validationDate: '2025-01-01',
          isVerified: true,
          certificateFile: '/private/certificate.pdf',
          password: 'nested-secret',
          refreshTokens: ['nested-secret'],
        },
        null,
        'unexpected-entry',
        ['array-entry'],
      ],
      achievements: [
        {
          achievement: 'Public Award',
          year: 2024,
          proofFile: '/private/proof.pdf',
          emailVerificationOtp: 'nested-otp',
          extraPrivateField: 'secret',
        },
        null,
        42,
      ],
    }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  };

  try {
    const res = mockResponse();
    await userController.getUsers({ query: {} }, res, assert.fail);

    assert.equal(res.body.success, true);
    assert.equal(searchArguments.role, 'student');
    assert.equal(res.body.data[0].name, storedUser.name);
    assert.equal(res.body.data[0]._id, storedUser._id);
    assert.equal(res.body.data[0].companyProfile.companyName, 'Public Company');
    assert.equal(res.body.data[0].collegeProfile.collegeName, 'Public College');
    assert.equal('resumeUrl' in res.body.data[0], false);
    for (const key of sensitiveKeys) {
      assert.equal(key in res.body.data[0], false, `${key} must be omitted`);
    }
    assert.deepEqual(res.body.data[0].companyProfile, { companyName: 'Public Company' });
    assert.deepEqual(res.body.data[0].collegeProfile, { collegeName: 'Public College' });
    assert.deepEqual(res.body.data[0].skills, [{ name: 'JavaScript', level: 'advanced', endorsedCount: 3 }]);
    assert.deepEqual(res.body.data[0].projects, [{
      id: 'project-1',
      title: 'Public Project',
      description: 'A public project',
      tags: ['web'],
      verified: true,
      repoUrl: 'https://example.com/repo',
      liveUrl: 'https://example.com/app',
    }]);
    assert.deepEqual(res.body.data[0].metrics, [{ label: 'Projects', value: 4, color: '#123456' }]);
    assert.deepEqual(res.body.data[0].certifications, [{
      name: 'Public Certification',
      issuingOrganization: 'Example Org',
      validationDate: '2025-01-01',
      isVerified: true,
    }]);
    assert.deepEqual(res.body.data[0].achievements, [{ achievement: 'Public Award', year: 2024 }]);
    for (const entry of [
      ...res.body.data[0].skills,
      ...res.body.data[0].projects,
      ...res.body.data[0].metrics,
      ...res.body.data[0].certifications,
      ...res.body.data[0].achievements,
    ]) {
      for (const privateField of [
        'certificateFile', 'proofFile', 'password', 'refreshTokens',
        'emailVerificationOtp', 'extraPrivateField', 'privateNote', 'secret',
      ]) {
        assert.equal(privateField in entry, false, `${privateField} must not be returned`);
      }
    }
  } finally {
    userService.searchUsers = originalSearchUsers;
  }
});

test('user directory query selects only allowlisted fields and sanitizes stored records', async () => {
  const originalFind = User.find;
  const originalCountDocuments = User.countDocuments;
  let selectedFields = '';
  const directoryRecord = {
    ...storedUser,
    skills: [{ name: 'Skill', level: 'intermediate', endorsedCount: 1, private: 'x' }, null],
    projects: [{ title: 'Project', description: 'Description', secret: 'x' }, 'malformed'],
    metrics: [{ label: 'Metric', value: 1, private: 'x' }, 42],
    certifications: [{ name: 'Certification', certificateFile: '/private/cert.pdf', secret: 'x' }, null],
    achievements: [{ achievement: 'Award', proofFile: '/private/proof.pdf', secret: 'x' }, 'malformed'],
  };
  User.find = () => ({
    select(fields) {
      selectedFields = fields;
      return this;
    },
    sort() { return this; },
    skip() { return this; },
    limit: async () => [directoryRecord],
  });
  User.countDocuments = async () => 1;

  try {
    const result = await userService.searchUsers({});
    assert.equal(result.users.length, 1);
    for (const key of sensitiveKeys) {
      assert.equal(key in result.users[0], false, `${key} must be omitted`);
      assert.equal(selectedFields.split(/\s+/).includes(key), false, `${key} must not be selected`);
    }
    assert.equal('resumeUrl' in result.users[0], false);
    assert.equal(result.users[0]._id, storedUser._id);
    assert.equal(result.users[0].profileIcon, storedUser.profileIcon);
    assert.deepEqual(result.users[0].skills, [{ name: 'Skill', level: 'intermediate', endorsedCount: 1 }]);
    assert.deepEqual(result.users[0].projects, [{ title: 'Project', description: 'Description' }]);
    assert.deepEqual(result.users[0].metrics, [{ label: 'Metric', value: 1 }]);
    assert.deepEqual(result.users[0].certifications, [{ name: 'Certification' }]);
    assert.deepEqual(result.users[0].achievements, [{ achievement: 'Award' }]);
  } finally {
    User.find = originalFind;
    User.countDocuments = originalCountDocuments;
  }
});

test('directory sanitizer safely drops malformed nested profile and array values', () => {
  const sanitized = sanitizeDirectoryUser({
    _id: 'stable-id',
    companyProfile: null,
    collegeProfile: 42,
    skills: { secret: 'not-an-array' },
    projects: 'not-an-array',
    metrics: null,
    certifications: 12,
    achievements: { proofFile: '/private/proof.pdf' },
    unexpectedPrivateField: 'secret',
  });

  assert.equal(sanitized._id, 'stable-id');
  assert.equal('companyProfile' in sanitized, false);
  assert.equal('collegeProfile' in sanitized, false);
  assert.deepEqual(sanitized.skills, []);
  assert.deepEqual(sanitized.projects, []);
  assert.deepEqual(sanitized.metrics, []);
  assert.deepEqual(sanitized.certifications, []);
  assert.deepEqual(sanitized.achievements, []);
  assert.equal('unexpectedPrivateField' in sanitized, false);
});

test('public directory controller forwards requested role and preserves response shape', async () => {
  const originalSearchUsers = userService.searchUsers;
  let forwarded;
  userService.searchUsers = async (args) => {
    forwarded = args;
    return { users: [{ _id: 'stable-student-id', name: 'Student' }], pagination: { page: 2, limit: 10, total: 1, totalPages: 1 } };
  };

  try {
    const res = mockResponse();
    await userController.getUsers({ query: { role: 'student', page: '2', limit: '10' } }, res, assert.fail);
    assert.equal(forwarded.role, 'student');
    assert.equal(forwarded.page, 2);
    assert.equal(forwarded.limit, 10);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data[0]._id, 'stable-student-id');
    assert.deepEqual(res.body.pagination, { page: 2, limit: 10, total: 1, totalPages: 1 });
  } finally {
    userService.searchUsers = originalSearchUsers;
  }
});

test('college student roster requires authentication and rejects non-college users', async () => {
  const route = userRoutes.stack.find((layer) => layer.route?.path === '/college/students');
  assert.ok(route, 'college roster route should exist');
  assert.equal(route.route.stack[0].handle, authMiddleware);

  const denied = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await userController.getCollegeStudents({ user: { id: 'student-1', role: 'student' }, query: {} }, denied, assert.fail);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.success, false);
  assert.equal('data' in denied.body, false);

  const unauthenticated = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  authMiddleware({ headers: {} }, unauthenticated, assert.fail);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal('data' in unauthenticated.body, false);
});

test('college roster stays unavailable to unverified and self-asserted college accounts', async () => {
  const route = userRoutes.stack.find((layer) => layer.route?.path === '/college/students');
  assert.ok(route);
  for (const user of [
    undefined,
    { id: 'student-1', role: 'student', college: 'Example University' },
    { id: 'college-1', role: 'college', college: 'Example University' },
  ]) {
    const res = {
      statusCode: undefined,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await userController.getCollegeStudents({ user, query: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal('data' in res.body, false);
  }
});

test('current profile and settings update responses exclude stored auth secrets', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  User.findById = () => ({ select: async () => storedUser });
  User.findByIdAndUpdate = () => ({
    select: (fields) => {
      const allowed = new Set(fields.split(/\s+/).filter(Boolean));
      return Object.fromEntries(
        Object.entries(storedUser).filter(([key]) => key === '_id' || allowed.has(key))
      );
    },
  });

  try {
    const profile = await userService.updateProfile(storedUser._id, { headline: 'Updated headline' });
    const settings = await userService.updateSettings(storedUser._id, {
      notificationPreferences: { applicationUpdates: false },
    });

    for (const result of [profile, settings]) {
      for (const key of sensitiveKeys) assert.equal(key in result, false, `${key} must be omitted`);
    }
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});
