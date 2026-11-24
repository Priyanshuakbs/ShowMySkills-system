import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Application from '../src/models/Application.js';
import uploadRoutes from '../src/routes/uploadRoutes.js';
import { uploadController } from '../src/controllers/uploadController.js';
import { uploadResume, formatFileUrl } from '../src/services/uploadService.js';
import { authMiddleware } from '../src/middleware/authMiddleware.js';
import { userService } from '../src/services/userService.js';
import storageService from '../src/services/storageService.js';

const resumeDirectory = path.join(process.cwd(), 'uploads', 'resumes');
const makeFile = async (name, content = 'resume content') => {
  const filePath = path.join(resumeDirectory, name);
  await fs.writeFile(filePath, content);
  return filePath;
};

const makeRequest = (filename, filePath) => ({
  user: { id: 'student-1' },
  file: {
    filename,
    path: filePath,
    size: 1024,
    mimetype: 'application/pdf',
  },
});

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

const getResumeRouteMiddleware = () => {
  const route = uploadRoutes.stack.find((layer) => layer.route?.path === '/resume' && layer.route.methods.post);
  assert.ok(route, 'POST /resume must remain registered');
  return route.route.stack[0].handle;
};

const runMultipart = async (filename, mimetype, size) => {
  const boundary = 'resume-test-boundary';
  const opening = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimetype}\r\n\r\n`
  );
  const fileContents = Buffer.alloc(size, 1);
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([opening, fileContents, closing]);
  const req = Readable.from([body]);
  req.method = 'POST';
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  req.body = {};
  return new Promise((resolve) => getResumeRouteMiddleware()(req, {}, resolve));
};

test('resume upload route requires authentication and retains the 10 MB limit', () => {
  assert.ok(uploadRoutes.stack.some((layer) => layer.handle === authMiddleware));
  assert.equal(uploadResume.limits.fileSize, 10 * 1024 * 1024);
});

test('resume upload accepts PDF, DOC, and DOCX MIME types and rejects unsupported types', () => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  for (const mimetype of allowed) {
    let error;
    let accepted;
    uploadResume.fileFilter({}, { mimetype }, (err, result) => {
      error = err;
      accepted = result;
    });
    assert.equal(error, null);
    assert.equal(accepted, true);
  }

  let rejected;
  uploadResume.fileFilter({}, { mimetype: 'text/plain' }, (error) => {
    rejected = error;
  });
  assert.match(rejected.message, /Only PDF, DOC, and DOCX/);
});

test('resume route maps invalid file types to 400 and files over 10 MB to 413', async () => {
  const invalidFileError = await runMultipart('notes.txt', 'text/plain', 128);
  assert.equal(invalidFileError.statusCode, 400);
  assert.match(invalidFileError.message, /Invalid document format/);

  const oversizedError = await runMultipart('large.pdf', 'application/pdf', 10 * 1024 * 1024 + 1);
  assert.equal(oversizedError.code, 'LIMIT_FILE_SIZE');
  assert.equal(oversizedError.statusCode, 413);
});

test('resume storage failures are forwarded as server errors', async () => {
  const originalHandleFile = uploadResume.storage._handleFile;
  const storageError = new Error('resume storage unavailable');
  uploadResume.storage._handleFile = (_req, file, callback) => {
    file.stream.resume();
    callback(storageError);
  };

  try {
    const error = await runMultipart('resume.pdf', 'application/pdf', 128);
    assert.equal(error, storageError);
    assert.equal(error.statusCode, undefined);
  } finally {
    uploadResume.storage._handleFile = originalHandleFile;
  }
});

test('first resume upload persists resumeUrl to the authenticated user', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let updateId;
  let update;
  let options;
  let selected;
  const filename = `first-resume-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  const filePath = await makeFile(filename);

  User.findById = () => ({ select: async () => ({ resumeUrl: '' }) });
  User.findByIdAndUpdate = (id, payload, opts) => {
    updateId = id;
    update = payload;
    options = opts;
    return { select: async (projection) => {
      selected = projection;
      return {
        resumeUrl: payload.$set.resumeUrl,
        completionPercentage: payload.$set.completionPercentage,
      };
    } };
  };

  try {
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(filename, filePath), res, assert.fail);

    assert.equal(updateId, 'student-1');
    assert.equal(update.$set.resumeUrl, formatFileUrl({}, { filename }, 'resumes'));
    assert.equal(options.new, true);
    assert.equal(options.runValidators, true);
    assert.match(selected, /completionPercentage/);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.url, update.$set.resumeUrl);
    assert.equal(res.body.data.resumeUrl, update.$set.resumeUrl);
    assert.equal(res.body.data.completionPercentage, update.$set.completionPercentage);
    assert.equal('refreshTokens' in res.body.data, false);
    assert.equal('password' in res.body.data, false);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'resume content');
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    await fs.rm(filePath, { force: true });
  }
});

test('replacing a resume deletes the old local file only when no other user references it', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const originalCountDocuments = User.countDocuments;
  const originalApplicationCountDocuments = Application.countDocuments;
  const oldFilename = `old-resume-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  const newFilename = `new-resume-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  const oldFilePath = await makeFile(oldFilename, 'old resume');
  const newFilePath = await makeFile(newFilename, 'new resume');
  const oldUrl = `http://localhost:5000/uploads/resumes/${oldFilename}`;
  let countQuery;
  let applicationCountQuery;

  User.findById = () => ({ select: async () => ({ resumeUrl: oldUrl }) });
  User.findByIdAndUpdate = (_id, payload) => ({
    select: async () => ({
      resumeUrl: payload.$set.resumeUrl,
      completionPercentage: payload.$set.completionPercentage,
    }),
  });
  User.countDocuments = async (query) => {
    countQuery = query;
    return 0;
  };
  Application.countDocuments = async (query) => {
    applicationCountQuery = query;
    return 0;
  };

  try {
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(newFilename, newFilePath), res, assert.fail);
    assert.equal(res.body.data.resumeUrl, res.body.data.url);
    assert.deepEqual(countQuery, { resumeUrl: oldUrl, _id: { $ne: 'student-1' } });
    assert.deepEqual(applicationCountQuery, { 'candidateSnapshot.resumeUrl': oldUrl });
    await assert.rejects(fs.access(oldFilePath));
    assert.equal(await fs.readFile(newFilePath, 'utf8'), 'new resume');

    // A second replacement scenario where another profile still points to the old file.
    await fs.writeFile(oldFilePath, 'shared resume');
    User.findById = () => ({ select: async () => ({ resumeUrl: oldUrl }) });
    User.countDocuments = async () => 0;
    Application.countDocuments = async () => 1;
    const sharedNewFilename = `shared-new-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
    const sharedNewPath = await makeFile(sharedNewFilename, 'replacement');
    const sharedRes = mockResponse();
    try {
      await uploadController.handleResumeUpload(makeRequest(sharedNewFilename, sharedNewPath), sharedRes, assert.fail);
      assert.equal(await fs.readFile(oldFilePath, 'utf8'), 'shared resume');
    } finally {
      await fs.rm(sharedNewPath, { force: true });
    }
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    User.countDocuments = originalCountDocuments;
    Application.countDocuments = originalApplicationCountDocuments;
    await fs.rm(oldFilePath, { force: true });
    await fs.rm(newFilePath, { force: true });
  }
});

test('missing user and database update failures clean up the new resume file', async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const missingFilename = `missing-user-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  const missingPath = await makeFile(missingFilename);
  let failurePath;
  User.findById = () => ({ select: async () => null });

  try {
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(missingFilename, missingPath), res, assert.fail);
    assert.equal(res.statusCode, 404);
    await assert.rejects(fs.access(missingPath));

    const failureFilename = `db-failure-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
    failurePath = await makeFile(failureFilename);
    User.findById = () => ({ select: async () => ({ resumeUrl: '' }) });
    User.findByIdAndUpdate = () => ({ select: async () => { throw new Error('database write failed'); } });
    let forwardedError;
    await uploadController.handleResumeUpload(
      makeRequest(failureFilename, failurePath),
      mockResponse(),
      (error) => { forwardedError = error; }
    );
    assert.equal(forwardedError.message, 'database write failed');
    await assert.rejects(fs.access(failurePath));
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    await fs.rm(missingPath, { force: true });
    if (failurePath) await fs.rm(failurePath, { force: true });
  }
});

test('resume metadata failure preserves centralized files and removes the local temporary file', async () => {
  const originals = {
    findById: User.findById,
    findByIdAndUpdate: User.findByIdAndUpdate,
    updateResume: userService.updateResume,
    isConfigured: storageService.isConfigured,
    uploadFile: storageService.uploadFile,
    deleteFile: storageService.deleteFile,
  };
  const filename = `metadata-failure-${Date.now()}.pdf`;
  const filePath = await makeFile(filename);
  const oldUrl = 'https://storage.example/old-resume';
  const deletedIds = [];
  User.findById = () => ({ select: async () => ({ resumeUrl: oldUrl, resumeFileId: 'old-resume-id' }) });
  User.findByIdAndUpdate = () => { throw new Error('metadata write failed'); };
  userService.updateResume = async (_id, resumeUrl) => ({ resumeUrl, completionPercentage: 80 });
  storageService.isConfigured = () => true;
  storageService.uploadFile = async () => ({ url: 'https://storage.example/new-resume', fileId: 'new-resume-id' });
  storageService.deleteFile = async (fileId) => { deletedIds.push(fileId); };
  try {
    let forwarded;
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(filename, filePath), res, (error) => { forwarded = error; });
    assert.match(forwarded.message, /metadata write failed/);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
    assert.deepEqual(deletedIds, []);
  } finally {
    User.findById = originals.findById;
    User.findByIdAndUpdate = originals.findByIdAndUpdate;
    userService.updateResume = originals.updateResume;
    storageService.isConfigured = originals.isConfigured;
    storageService.uploadFile = originals.uploadFile;
    storageService.deleteFile = originals.deleteFile;
    await fs.rm(filePath, { force: true });
  }
});

test('resume centralized upload removes its local temporary file after profile and metadata persistence', async () => {
  const originals = {
    findById: User.findById,
    findByIdAndUpdate: User.findByIdAndUpdate,
    updateResume: userService.updateResume,
    isConfigured: storageService.isConfigured,
    uploadFile: storageService.uploadFile,
    deleteFile: storageService.deleteFile,
  };
  const filename = `central-cleanup-${Date.now()}.pdf`;
  const filePath = await makeFile(filename);
  User.findById = () => ({ select: async () => ({ resumeUrl: '', resumeFileId: '' }) });
  User.findByIdAndUpdate = async () => ({});
  userService.updateResume = async (_id, resumeUrl) => ({ resumeUrl, completionPercentage: 80 });
  storageService.isConfigured = () => true;
  storageService.uploadFile = async () => ({ url: 'https://storage.example/new-resume', fileId: 'new-resume-id' });
  storageService.deleteFile = async () => {};
  try {
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(filename, filePath), res, assert.fail);
    assert.equal(res.statusCode, 201);
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
  } finally {
    User.findById = originals.findById;
    User.findByIdAndUpdate = originals.findByIdAndUpdate;
    userService.updateResume = originals.updateResume;
    storageService.isConfigured = originals.isConfigured;
    storageService.uploadFile = originals.uploadFile;
    storageService.deleteFile = originals.deleteFile;
    await fs.rm(filePath, { force: true });
  }
});

test('resume local fallback preserves the file referenced by the saved profile URL', async () => {
  const originals = {
    findById: User.findById,
    updateResume: userService.updateResume,
    isConfigured: storageService.isConfigured,
    uploadFile: storageService.uploadFile,
  };
  const filename = `local-fallback-${Date.now()}.pdf`;
  const filePath = await makeFile(filename);
  User.findById = () => ({ select: async () => ({ resumeUrl: '', resumeFileId: '' }) });
  userService.updateResume = async (_id, resumeUrl) => ({ resumeUrl, completionPercentage: 80 });
  storageService.isConfigured = () => true;
  storageService.uploadFile = async () => { throw new Error('storage unavailable'); };
  try {
    const res = mockResponse();
    await uploadController.handleResumeUpload(makeRequest(filename, filePath), res, assert.fail);
    assert.equal(res.statusCode, 201);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'resume content');
  } finally {
    User.findById = originals.findById;
    userService.updateResume = originals.updateResume;
    storageService.isConfigured = originals.isConfigured;
    storageService.uploadFile = originals.uploadFile;
    await fs.rm(filePath, { force: true });
  }
});

test('resume download requires authentication and is limited to the owner or an applicant company', async () => {
  const userAFilename = `user-a-${Date.now()}-12345.pdf`;
  const userBFilename = `user-b-${Date.now()}-67890.pdf`;
  const userAResume = formatFileUrl({}, { filename: userAFilename }, 'resumes');
  const userBResume = formatFileUrl({}, { filename: userBFilename }, 'resumes');
  const userAFilePath = await makeFile(userAFilename, '%PDF-1.4\nUser A resume');
  const filePath = await makeFile(userBFilename, '%PDF-1.4\nResume test');
  const server = app.listen(0, '127.0.0.1');
  const originalUserExists = User.exists;
  const originalApplicationExists = Application.exists;
  const originalApplicationDistinct = Application.distinct;
  const userQueries = [];
  const applicationQueries = [];
  User.exists = async (query) => {
    userQueries.push(query);
    const userIds = Array.isArray(query._id?.$in) ? query._id.$in : [query._id];
    return (userIds.includes('student-a') && query.resumeUrl === userAResume) ||
      (userIds.includes('student-b') && query.resumeUrl === userBResume);
  };
  Application.exists = async (query) => {
    assert.fail('Applicant-company authorization must verify the application student owner');
  };
  Application.distinct = async (field, query) => {
    assert.equal(field, 'student');
    applicationQueries.push(query);
    const hasCompanyApplication = query.company === 'recruiter-company';
    const snapshotReference = query['candidateSnapshot.resumeUrl'];
    return hasCompanyApplication && [userAResume, userBResume].includes(snapshotReference)
      ? ['student-a']
      : [];
  };
  const secret = process.env.JWT_SECRET || 'dev_secret_key_showmyskills_2026';
  const tokenFor = (sub) => jwt.sign({ sub, role: sub === 'recruiter-company' ? 'company' : 'student' }, secret);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/uploads/resumes/${userBFilename}`;
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);

    const userAAttempt = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor('student-a')}` },
    });
    assert.equal(userAAttempt.status, 404);

    const userAOwnDownload = await fetch(
      `http://127.0.0.1:${server.address().port}/uploads/resumes/${userAFilename}`,
      { headers: { Authorization: `Bearer ${tokenFor('student-a')}` } }
    );
    assert.equal(userAOwnDownload.status, 200);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor('student-b')}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), new RegExp(`attachment; filename="${userBFilename}"`));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(await response.text(), /^%PDF-1\.4/);

    const companyDownload = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenFor('recruiter-company')}` },
    });
    assert.equal(companyDownload.status, 404, 'a poisoned snapshot must not authorize another student’s resume');

    const companyApplicantDownload = await fetch(
      `http://127.0.0.1:${server.address().port}/uploads/resumes/${userAFilename}`,
      { headers: { Authorization: `Bearer ${tokenFor('recruiter-company')}` } }
    );
    assert.equal(companyApplicantDownload.status, 200, 'the company may access its applicant’s own resume');

    const unassociatedCompanyDownload = await fetch(
      `http://127.0.0.1:${server.address().port}/uploads/resumes/${userAFilename}`,
      { headers: { Authorization: `Bearer ${tokenFor('other-company')}` } }
    );
    assert.equal(unassociatedCompanyDownload.status, 404);

    const invalidReference = await fetch(
      `http://127.0.0.1:${server.address().port}/uploads/resumes/unknown-${Date.now()}-99999.pdf`,
      { headers: { Authorization: `Bearer ${tokenFor('recruiter-company')}` } }
    );
    assert.equal(invalidReference.status, 404);

    const traversalAttempt = await fetch(
      `http://127.0.0.1:${server.address().port}/uploads/resumes/%2e%2e%2f${userBFilename}`,
      { headers: { Authorization: `Bearer ${tokenFor('student-b')}` } }
    );
    assert.equal(traversalAttempt.status, 404);
    assert.ok(userQueries.some((query) => query._id === 'student-a' && query.resumeUrl === userBResume));
    assert.ok(userQueries.some((query) =>
      query._id?.$in?.includes('student-a') && query.resumeUrl === userBResume
    ), 'the poisoned application path must verify the resume against its student owner');
    assert.ok(userQueries.some((query) => query._id === 'student-b' && query.resumeUrl === userBResume));
    assert.ok(applicationQueries.some((query) =>
      query.company === 'recruiter-company' && query['candidateSnapshot.resumeUrl'] === userBResume
    ));
    assert.ok(applicationQueries.some((query) =>
      query.company === 'recruiter-company' && query['candidateSnapshot.resumeUrl'] === userAResume
    ));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    User.exists = originalUserExists;
    Application.exists = originalApplicationExists;
    Application.distinct = originalApplicationDistinct;
    await fs.rm(userAFilePath, { force: true });
    await fs.rm(filePath, { force: true });
  }
});
