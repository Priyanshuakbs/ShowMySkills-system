import assert from 'node:assert/strict';
import { test } from 'node:test';
import User from '../src/models/User.js';
import { userService, calculateProfileCompletion } from '../src/services/userService.js';
import { uploadController } from '../src/controllers/uploadController.js';
import { emailService } from '../src/services/emailService.js';

const completeStudent = {
  role: 'student',
  name: 'Asha Student',
  headline: 'Backend Developer',
  bio: 'I build reliable systems.',
  location: 'Bengaluru',
  profileIcon: 'https://images.example.com/asha.png',
  college: 'Example University',
  course: 'B.Tech',
  branch: 'Computer Science',
  graduationYear: 2027,
  skills: [{ name: 'Node.js' }],
  projects: [{ title: 'Portfolio API' }],
  resumeUrl: 'https://files.example.com/asha.pdf',
  githubUrl: 'https://github.com/asha',
  certifications: [{ name: 'Cloud Fundamentals' }],
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

const installProfilePersistence = (profile) => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let persisted = structuredClone(profile);
  let lastUpdate;

  User.findById = () => ({ select: async () => structuredClone(persisted) });
  User.findByIdAndUpdate = (_id, update) => {
    lastUpdate = update;
    persisted = { ...persisted, ...update.$set };
    return { select: async () => structuredClone(persisted) };
  };

  return {
    get update() { return lastUpdate; },
    get persisted() { return persisted; },
    restore() {
      User.findById = originalFindById;
      User.findByIdAndUpdate = originalFindByIdAndUpdate;
    },
  };
};

test('new users default to zero completion instead of a misleading 80 percent', () => {
  assert.equal(User.schema.path('completionPercentage').defaultValue, 0);
  assert.equal(calculateProfileCompletion({ role: 'student' }), 0);
});

test('current profile reads correct and persist a stale saved completion score', async () => {
  const originalFindById = User.findById;
  const existing = {
    ...completeStudent,
    bio: '',
    completionPercentage: 80,
    toObject() {
      return { ...this };
    },
    async save() {
      this.savedScore = this.completionPercentage;
    },
  };
  User.findById = () => ({ select: async () => existing });

  try {
    const current = await userService.getCurrentUserById('64f1a2b3c4d5e6f7a8b9c111');
    assert.equal(current.completionPercentage, 90);
    assert.equal(current.savedScore, 90);
  } finally {
    User.findById = originalFindById;
  }
});

test('production calculator scores partial and fully complete student profiles', () => {
  assert.equal(calculateProfileCompletion({ role: 'student', name: 'Asha' }), 10);
  assert.equal(calculateProfileCompletion(completeStudent), 100);

  const withoutAvatar = { ...completeStudent, profileIcon: '' };
  assert.equal(calculateProfileCompletion(withoutAvatar), 95);
});

test('production calculator uses role-specific company and college profile fields', () => {
  const companyProfile = {
    role: 'company',
    name: 'Acme',
    location: 'Bengaluru',
    companyProfile: {
      companyName: 'Acme', tagline: 'Build better', aboutCompany: 'We build tools.',
      logo: 'https://example.com/logo.png', establishedYear: 2015, industryType: 'Software',
      companySize: '51-200', website: 'https://example.com', linkedin: 'https://linkedin.com/acme',
      awards: [{ name: 'Best Product' }],
    },
  };
  assert.equal(calculateProfileCompletion(companyProfile), 100);

  const collegeProfile = {
    role: 'college',
    name: 'Example College',
    profileIcon: '/uploads/college.png',
    location: 'Mysuru',
    collegeProfile: {
      collegeName: 'Example College', aboutCollege: 'A learning community.', establishedYear: 1990,
      collegeType: 'Public', pincode: '570001', departments: ['Engineering'], courses: ['B.Tech'],
      website: 'https://college.example', linkedin: 'https://linkedin.com/college', numberOfStudents: 5000,
    },
  };
  assert.equal(calculateProfileCompletion(collegeProfile), 100);
});

test('completion stays an integer between zero and 100 for all inputs', () => {
  for (const profile of [
    {},
    { name: 'A', headline: 'B', bio: 'C', location: 'D', profileIcon: 'E' },
    { ...completeStudent, skills: Array(100).fill({ name: 'Skill' }) },
  ]) {
    const score = calculateProfileCompletion(profile);
    assert.equal(Number.isInteger(score), true);
    assert.ok(score >= 0 && score <= 100);
  }
});

test('partial profile update calculates from saved fields plus the submitted change', async () => {
  const savedProfile = { ...completeStudent, bio: '' };
  const persistence = installProfilePersistence(savedProfile);
  try {
    const updated = await userService.updateProfile('64f1a2b3c4d5e6f7a8b9c111', { bio: 'Updated biography' });
    assert.equal(persistence.update.$set.bio, 'Updated biography');
    assert.equal(persistence.update.$set.completionPercentage, 100);
    assert.equal(updated.completionPercentage, 100);
    assert.equal(persistence.persisted.name, savedProfile.name);
    assert.equal(persistence.persisted.resumeUrl, savedProfile.resumeUrl);
  } finally {
    persistence.restore();
  }
});

test('profile update persists and returns its recalculated completion percentage', async () => {
  const persistence = installProfilePersistence({ role: 'student', name: 'Asha' });
  try {
    const updated = await userService.updateProfile('64f1a2b3c4d5e6f7a8b9c111', {
      headline: 'Backend Developer',
      bio: 'I build reliable systems.',
    });
    assert.equal(persistence.update.$set.completionPercentage, 30);
    assert.equal(persistence.persisted.completionPercentage, 30);
    assert.equal(updated.completionPercentage, 30);
  } finally {
    persistence.restore();
  }
});

test('resume upload recalculates completion using the saved profile and returns the percentage', async () => {
  const savedProfile = { ...completeStudent, resumeUrl: '' };
  const persistence = installProfilePersistence(savedProfile);
  try {
    const req = {
      user: { id: '64f1a2b3c4d5e6f7a8b9c111' },
      file: { filename: 'asha-resume.pdf', size: 1024, mimetype: 'application/pdf' },
    };
    const res = mockResponse();
    await uploadController.handleResumeUpload(req, res, assert.fail);
    assert.equal(persistence.update.$set.completionPercentage, 100);
    assert.equal(res.body.data.completionPercentage, 100);
    assert.equal(res.body.data.resumeUrl, persistence.update.$set.resumeUrl);
  } finally {
    persistence.restore();
  }
});

test('avatar upload applies the chosen five point contribution through the profile service', async () => {
  const withoutAvatar = { ...completeStudent, profileIcon: '' };
  const persistence = installProfilePersistence(withoutAvatar);
  try {
    const updated = await userService.updateProfile('64f1a2b3c4d5e6f7a8b9c111', {
      profileIcon: 'https://images.example.com/asha.png',
    });
    assert.equal(persistence.update.$set.completionPercentage, 100);
    assert.equal(updated.completionPercentage, 100);
  } finally {
    persistence.restore();
  }
});

test('signup persists a calculated profile percentage in the created user', async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalSendVerificationOtp = emailService.sendVerificationOtp;
  let createdPayload;
  User.findOne = async () => null;
  User.create = async (payload) => {
    createdPayload = payload;
    return { toObject: () => ({ ...payload, _id: 'new-user' }) };
  };
  emailService.sendVerificationOtp = async () => {};

  try {
    await userService.createUser({
      name: 'New Student',
      email: 'new-student@example.com',
      phone: '555-0100',
      password: 'password123',
      role: 'student',
      college: 'Example University',
      graduationYear: 2028,
      collegeId: 'EX-123',
    });
    assert.equal(createdPayload.completionPercentage, 20);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    emailService.sendVerificationOtp = originalSendVerificationOtp;
  }
});
