import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import User from '../src/models/User.js';
import { uploadController } from '../src/controllers/uploadController.js';
import uploadRoutes from '../src/routes/uploadRoutes.js';
import { uploadAvatar } from '../src/services/uploadService.js';
import { authMiddleware } from '../src/middleware/authMiddleware.js';
import { userService } from '../src/services/userService.js';
import { validateProfileUpdate } from '../src/validators/authValidator.js';

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

test('avatar upload route requires authentication and uses the existing 5 MB limit', () => {
  assert.ok(uploadRoutes.stack.some((layer) => layer.handle === authMiddleware));
  assert.equal(uploadAvatar.limits.fileSize, 5 * 1024 * 1024);
});

test('avatar upload accepts supported image MIME types and rejects unsupported types', () => {
  for (const mimetype of ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']) {
    let error;
    let accepted;
    uploadAvatar.fileFilter({}, { mimetype }, (err, result) => {
      error = err;
      accepted = result;
    });
    assert.equal(error, null);
    assert.equal(accepted, true);
  }

  let rejected;
  uploadAvatar.fileFilter({}, { mimetype: 'image/gif' }, (error) => {
    rejected = error;
  });
  assert.match(rejected.message, /Only JPEG, PNG, WebP, and SVG/);
});

test('avatar upload rejects a multipart image larger than 5 MB', async () => {
  const boundary = 'avatar-test-boundary';
  const opening = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.png"\r\n` +
    'Content-Type: image/png\r\n\r\n'
  );
  const oversizedImage = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([opening, oversizedImage, closing]);
  const req = Readable.from([body]);
  req.method = 'POST';
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  req.body = {};

  const error = await new Promise((resolve) => {
    uploadAvatar.single('file')(req, {}, resolve);
  });

  assert.ok(error, 'Multer should reject the oversized multipart file');
  assert.equal(error.code, 'LIMIT_FILE_SIZE', error.message);
});

test('avatar upload persists profileIcon and returns its saved value', async () => {
  const originalUpdateProfile = userService.updateProfile;
  let capturedId;
  let capturedData;
  const savedAvatar = 'http://localhost:5000/uploads/avatars/portrait-123.png';

  userService.updateProfile = async (id, data) => {
    capturedId = id;
    capturedData = data;
    return {
      profileIcon: savedAvatar,
      completionPercentage: 15,
    };
  };

  try {
    const req = {
      user: { id: 'student-1' },
      file: {
        filename: 'portrait-123.png',
        size: 1024,
        mimetype: 'image/png',
      },
    };
    const res = mockResponse();
    await uploadController.handleAvatarUpload(req, res, assert.fail);

    assert.equal(capturedId, 'student-1');
    assert.deepEqual(capturedData, { profileIcon: savedAvatar });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.url, savedAvatar);
    assert.equal(res.body.data.profileIcon, savedAvatar);
    assert.equal(res.body.data.completionPercentage, 15);
    assert.equal('password' in res.body.data, false);
    assert.equal('refreshTokens' in res.body.data, false);
  } finally {
    userService.updateProfile = originalUpdateProfile;
  }
});

test('avatar upload removes the new file when profile persistence fails', async () => {
  const originalUpdateProfile = userService.updateProfile;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'showmyskills-avatar-'));
  const filePath = path.join(directory, 'new-avatar.png');
  await fs.writeFile(filePath, 'avatar');
  userService.updateProfile = async () => {
    throw new Error('database unavailable');
  };

  try {
    let forwardedError;
    const req = {
      user: { id: 'student-1' },
      file: { filename: 'new-avatar.png', path: filePath, size: 6, mimetype: 'image/png' },
    };
    await uploadController.handleAvatarUpload(req, mockResponse(), (error) => {
      forwardedError = error;
    });

    assert.match(forwardedError.message, /database unavailable/);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
  } finally {
    userService.updateProfile = originalUpdateProfile;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('avatar upload removes the new file when the authenticated user is missing', async () => {
  const originalUpdateProfile = userService.updateProfile;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'showmyskills-avatar-'));
  const filePath = path.join(directory, 'orphan-avatar.png');
  await fs.writeFile(filePath, 'avatar');
  userService.updateProfile = async () => null;

  try {
    const res = mockResponse();
    await uploadController.handleAvatarUpload({
      user: { id: 'missing-user' },
      file: { filename: 'orphan-avatar.png', path: filePath, size: 6, mimetype: 'image/png' },
    }, res, assert.fail);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
  } finally {
    userService.updateProfile = originalUpdateProfile;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('profile update accepts preset avatar URLs and rejects unsafe avatar values', () => {
  for (const profileIcon of [
    'https://images.example.com/avatars/student.png',
    '/avatars/default-student.svg',
    'uploads/avatars/saved-avatar.webp',
    '',
    null,
  ]) {
    let nextCalled = false;
    const res = mockResponse();
    validateProfileUpdate({ body: { profileIcon } }, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, `${String(profileIcon)} should be allowed`);
  }

  for (const profileIcon of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    '//external.example/avatar.png',
    'https://user:password@example.com/avatar.png',
    `https://images.example.com/${'a'.repeat(2050)}.png`,
  ]) {
    const res = mockResponse();
    validateProfileUpdate({ body: { profileIcon } }, res, assert.fail);
    assert.equal(res.statusCode, 400, `${profileIcon.slice(0, 40)} should be rejected`);
    assert.equal(res.body.success, false);
  }
});

test('selecting a preset avatar persists and returns profileIcon through the profile service', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const presetAvatar = 'https://images.example.com/avatars/preset-student.png';
  let capturedUpdate;
  User.findById = () => ({ select: async () => ({
    role: 'student', name: 'Student', headline: 'Builder', bio: 'Bio', location: 'City',
    college: 'College', course: 'Course', branch: 'Branch', graduationYear: 2027,
    skills: [{ name: 'JS' }], projects: [{ title: 'App' }], resumeUrl: '/resume.pdf',
    portfolioUrl: 'https://example.com', certifications: [{ name: 'Cert' }],
  }) });
  User.findByIdAndUpdate = (_id, update) => {
    capturedUpdate = update;
    return {
      select: () => ({ _id: 'student-1', profileIcon: presetAvatar, name: 'Student' }),
    };
  };

  try {
    const profile = await userService.updateProfile('student-1', { profileIcon: presetAvatar });
    assert.equal(capturedUpdate.$set.profileIcon, presetAvatar);
    assert.equal(profile.profileIcon, presetAvatar);
    assert.equal('password' in profile, false);
    assert.equal('refreshTokens' in profile, false);
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test('profile update route applies authentication and avatar/profile validation', async () => {
  const { default: userRoutes } = await import('../src/routes/userRoutes.js');
  const { userController } = await import('../src/controllers/userController.js');
  const route = userRoutes.stack.find((layer) => layer.route?.path === '/profile' && layer.route.methods.put);
  assert.ok(route);
  const handlers = route.route.stack.map((layer) => layer.handle);
  assert.ok(handlers.includes(authMiddleware));
  assert.ok(handlers.includes(validateProfileUpdate));
  assert.ok(handlers.includes(userController.updateProfile));
});
