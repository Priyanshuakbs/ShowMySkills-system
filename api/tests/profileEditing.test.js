import assert from 'node:assert/strict';
import { test } from 'node:test';
import User from '../src/models/User.js';
import { authController } from '../src/controllers/authController.js';
import { userController } from '../src/controllers/userController.js';
import authRoutes from '../src/routes/authRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import { userService } from '../src/services/userService.js';
import { validateProfileUpdate } from '../src/validators/authValidator.js';

const safeProfile = {
  _id: 'student-1',
  name: 'Asha Student',
  headline: 'Backend Developer',
  bio: 'Building useful systems',
  college: 'Example University',
  branch: 'Computer Science',
  skills: [{ name: 'Node.js', level: 'advanced' }],
  projects: [{ title: 'Portfolio API' }],
};

const mockResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const getRouteHandlers = (router, routePath, method) => {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} route must exist`);
  return layer.route.stack.map((item) => item.handle);
};

test('both existing profile update routes share auth, validation, and their controller update path', () => {
  const authHandlers = getRouteHandlers(authRoutes, '/me', 'put');
  const userHandlers = getRouteHandlers(userRoutes, '/profile', 'put');

  assert.ok(authHandlers.includes(validateProfileUpdate));
  assert.ok(userHandlers.includes(validateProfileUpdate));
  assert.ok(authHandlers.includes(authController.updateMe));
  assert.ok(userHandlers.includes(userController.updateProfile));
});

test('auth/me and users/profile return the same structure from the canonical profile service', async () => {
  const originalUpdateProfile = userService.updateProfile;
  const calls = [];
  userService.updateProfile = async (userId, body) => {
    calls.push({ userId, body });
    return safeProfile;
  };

  try {
    const body = { headline: 'Backend Developer' };
    const authRes = mockResponse();
    const usersRes = mockResponse();

    await authController.updateMe({ user: { id: 'student-1' }, body }, authRes, assert.fail);
    await userController.updateProfile({ user: { id: 'student-1' }, body }, usersRes, assert.fail);

    assert.deepEqual(calls, [
      { userId: 'student-1', body },
      { userId: 'student-1', body },
    ]);
    assert.deepEqual(authRes.body, {
      success: true,
      message: 'Profile updated successfully',
      data: safeProfile,
    });
    assert.deepEqual(usersRes.body, authRes.body);
  } finally {
    userService.updateProfile = originalUpdateProfile;
  }
});

test('profile service persists supported fields and leaves omitted fields untouched', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let capturedUpdate;
  let capturedOptions;
  let selectedProjection;
  User.findById = () => ({ select: async () => ({
    role: 'student',
    name: 'Existing Name',
    headline: 'Existing headline',
    bio: 'Existing bio',
    location: 'Existing city',
    profileIcon: '/uploads/avatars/existing.png',
    college: 'Existing college',
    course: 'Existing course',
    branch: 'Existing branch',
    graduationYear: 2026,
    skills: [{ name: 'Existing skill' }],
    projects: [{ title: 'Existing project' }],
    resumeUrl: '/uploads/resumes/existing.pdf',
    githubUrl: 'https://github.com/existing',
    certifications: [{ name: 'Existing cert' }],
  }) });
  User.findByIdAndUpdate = (_id, update, options) => {
    capturedUpdate = update;
    capturedOptions = options;
    return {
      select(fields) {
        selectedProjection = fields;
        return safeProfile;
      },
    };
  };

  try {
    const data = {
      name: 'Asha Student',
      headline: 'Backend Developer',
      about: 'Building useful systems',
      location: 'Bengaluru',
      phone: '+911234567890',
      college: 'Example University',
      course: 'B.Tech',
      department: 'Computer Science',
      graduationYear: 2027,
      skills: [{ name: 'Node.js', level: 'advanced' }],
      projects: [{ title: 'Portfolio API' }],
      certifications: [{ name: 'Cloud Fundamentals' }],
      achievements: [{ achievement: 'Hackathon finalist', year: 2025 }],
      portfolioUrl: 'https://example.com',
      github: 'https://github.com/asha',
      linkedin: 'https://linkedin.com/in/asha',
      openToWorkMessage: 'Available for backend roles',
      notificationPreferences: { applicationUpdates: false },
      collegeProfile: { collegeName: 'Example University' },
      resumeUrl: 'http://localhost:5000/uploads/resumes/user-b-1730000000000-1234.pdf',
    };

    const result = await userService.updateProfile('student-1', data);
    const set = capturedUpdate.$set;
    assert.equal(set.name, data.name);
    assert.equal(set.headline, data.headline);
    assert.equal(set.bio, data.about);
    assert.equal(set.location, data.location);
    assert.equal(set.phone, data.phone);
    assert.equal(set.college, data.college);
    assert.equal(set.course, data.course);
    assert.equal(set.branch, data.department);
    assert.equal(set.graduationYear, data.graduationYear);
    assert.deepEqual(set.skills, data.skills);
    assert.deepEqual(set.projects, data.projects);
    assert.deepEqual(set.certifications, data.certifications);
    assert.deepEqual(set.achievements, data.achievements);
    assert.equal(capturedOptions.runValidators, true);
    assert.equal(set.portfolioUrl, data.portfolioUrl);
    assert.equal(set.githubUrl, data.github);
    assert.equal(set.linkedinUrl, data.linkedin);
    assert.equal(set.openToWorkMessage, data.openToWorkMessage);
    assert.equal(set['notificationPreferences.applicationUpdates'], false);
    assert.equal(set['collegeProfile.collegeName'], 'Example University');
    assert.equal('resumeUrl' in set, false);
    assert.equal('dob' in set, false);
    assert.equal('email' in set, false);
    assert.match(selectedProjection, /name email phone/);
    assert.equal('password' in result, false);
    assert.equal('refreshTokens' in result, false);
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test('profile service strips submitted verification fields and preserves trusted metadata for unchanged records', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let capturedUpdate;
  const storedProfile = {
    role: 'company',
    name: 'Acme',
    companyProfile: { companyName: 'Acme', isVerified: false },
    projects: [{ id: 'p1', title: 'Verified project', description: 'Same', tags: ['api'], repoUrl: '', liveUrl: '', verified: true }],
    certifications: [{ name: 'Cloud', issuingOrganization: 'Board', validationDate: new Date('2025-01-01'), isVerified: false, certificateFile: '/private/cloud.pdf' }],
  };
  User.findById = () => ({ select: async () => structuredClone(storedProfile) });
  User.findByIdAndUpdate = (_id, update) => {
    capturedUpdate = update.$set;
    return { select: async () => safeProfile };
  };

  try {
    await userService.updateProfile('company-1', {
      companyProfile: { companyName: 'Updated Acme', isVerified: true, approvalStatus: 'approved' },
      projects: [
        { id: 'p1', title: 'Verified project', description: 'Same', tags: ['api'], repoUrl: '', liveUrl: '', verified: false },
        { id: 'p2', title: 'New project', description: 'New', tags: [], repoUrl: '', liveUrl: '', verified: true },
      ],
      certifications: [
        { name: 'Cloud', issuingOrganization: 'Board', validationDate: '2025-01-01', isVerified: true, certificateFile: '/attacker/file.pdf' },
      ],
    });

    assert.equal(capturedUpdate['companyProfile.companyName'], 'Updated Acme');
    assert.equal('companyProfile.isVerified' in capturedUpdate, false);
    assert.equal('companyProfile.approvalStatus' in capturedUpdate, false);
    assert.equal(capturedUpdate.projects[0].verified, true);
    assert.equal('verified' in capturedUpdate.projects[1], false);
    assert.equal(capturedUpdate.certifications[0].isVerified, false);
    assert.equal(capturedUpdate.certifications[0].certificateFile, '/private/cloud.pdf');
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test('profile validator accepts partial updates and rejects invalid field types and unsafe nested keys', () => {
  let nextCalled = false;
  const validRes = mockResponse();
  const validReq = { body: {
    bio: '', skills: [], companyProfile: { tagline: 'Builder', isVerified: true, privateField: 'ignored' },
    projects: [{ title: 'Project', verified: true, adminApproved: true }],
    certifications: [{ name: 'Cert', isVerified: true, certificateFile: '/private/file.pdf' }],
    resumeUrl: 'http://localhost:5000/uploads/resumes/user-b-1730000000000-1234.pdf',
  } };
  validateProfileUpdate(validReq, validRes, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(validRes.body, undefined);
  assert.deepEqual(validReq.body.companyProfile, { tagline: 'Builder' });
  assert.deepEqual(validReq.body.projects, [{ title: 'Project' }]);
  assert.deepEqual(validReq.body.certifications, [{ name: 'Cert' }]);
  assert.equal('resumeUrl' in validReq.body, false);

  const invalidRes = mockResponse();
  validateProfileUpdate({ body: { skills: 'Node.js' } }, invalidRes, assert.fail);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.success, false);

  const unsafeRes = mockResponse();
  validateProfileUpdate({ body: { companyProfile: { '$set': { tagline: 'Injected' } } } }, unsafeRes, assert.fail);
  assert.equal(unsafeRes.statusCode, 400);

  const invalidOpenToWorkMessageRes = mockResponse();
  validateProfileUpdate({ body: { openToWorkMessage: { unsafe: true } } }, invalidOpenToWorkMessageRes, assert.fail);
  assert.equal(invalidOpenToWorkMessageRes.statusCode, 400);
});
