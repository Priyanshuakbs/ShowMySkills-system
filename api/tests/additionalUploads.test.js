import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { uploadController } from '../src/controllers/uploadController.js';
import storageService from '../src/services/storageService.js';

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const temporaryUpload = async (handlerName, centralized) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'showmyskills-additional-upload-'));
  const filePath = path.join(directory, 'upload.bin');
  await fs.writeFile(filePath, 'upload');
  try {
    const res = response();
    let forwarded;
    await uploadController[handlerName]({
      user: { id: 'user-1' },
      file: { filename: 'upload.bin', path: filePath, originalname: 'upload.bin', mimetype: 'application/octet-stream', size: 6 },
    }, res, (error) => { forwarded = error; });
    assert.equal(forwarded, undefined);
    assert.equal(res.statusCode, 201);
    if (centralized) await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
    else assert.equal(await fs.readFile(filePath, 'utf8'), 'upload');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

test('certificate, attachment, and poster uploads remove temp files after centralized success', async () => {
  const originalIsConfigured = storageService.isConfigured;
  const originalUploadFile = storageService.uploadFile;
  storageService.isConfigured = () => true;
  storageService.uploadFile = async () => ({ url: 'https://storage.example/upload', fileId: 'upload-id' });
  try {
    for (const handler of ['handleCertificateUpload', 'handleAttachmentUpload', 'handleInternshipPosterUpload']) {
      await temporaryUpload(handler, true);
    }
  } finally {
    storageService.isConfigured = originalIsConfigured;
    storageService.uploadFile = originalUploadFile;
  }
});

test('certificate, attachment, and poster local fallback preserves temp files referenced by returned URLs', async () => {
  const originalIsConfigured = storageService.isConfigured;
  const originalUploadFile = storageService.uploadFile;
  storageService.isConfigured = () => true;
  storageService.uploadFile = async () => { throw new Error('storage unavailable'); };
  try {
    for (const handler of ['handleCertificateUpload', 'handleAttachmentUpload', 'handleInternshipPosterUpload']) {
      await temporaryUpload(handler, false);
    }
  } finally {
    storageService.isConfigured = originalIsConfigured;
    storageService.uploadFile = originalUploadFile;
  }
});
