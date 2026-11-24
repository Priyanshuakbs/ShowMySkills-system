import fs from 'node:fs/promises';
import path from 'node:path';
import { formatFileUrl } from '../services/uploadService.js';
import storageService from '../services/storageService.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { logger } from '../utils/logger.js';
import { userService } from '../services/userService.js';

const removeLocalFile = async (filePath, message) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn(message, error.message);
  }
};

const removeNewUpload = (filePath) => removeLocalFile(filePath, 'Could not remove failed upload file');
const removeCentralizedUploadTempFile = (filePath, centralizedUpload) =>
  centralizedUpload ? removeNewUpload(filePath) : Promise.resolve();

const processUploadToCentralizedStorage = async (req, subfolder) => {
  let fileUrl = formatFileUrl(req, req.file, subfolder);
  let fileId = null;
  let centralizedUpload = false;
  if (storageService.isConfigured() && req.file?.path) {
    try {
      const buffer = await fs.readFile(req.file.path);
      const result = await storageService.uploadFile({
        userId: req.user?.id || 'usr_anonymous',
        buffer,
        fileName: req.file.originalname || req.file.filename,
        mimeType: req.file.mimetype,
      });
      if (result?.url) {
        fileUrl = result.url;
        fileId = result.fileId || null;
        centralizedUpload = true;
      }
    } catch (error) {
      logger.warn(`Centralized upload fallback to local for ${subfolder}`, error.message);
    }
  }
  return { fileUrl, fileId, centralizedUpload };
};

const deleteOldFileFromStorage = async (fileId, userId) => {
  if (!fileId || !storageService.isConfigured()) return;
  try {
    await storageService.deleteFile(fileId, userId);
  } catch (error) {
    logger.warn('Could not delete old centralized file', error.message);
  }
};

const getLocalResumePath = (resumeUrl) => {
  if (!resumeUrl || typeof resumeUrl !== 'string') return null;
  try {
    const pathname = new URL(resumeUrl, 'http://localhost').pathname;
    const match = pathname.match(/^\/uploads\/resumes\/([^/]+)$/);
    if (!match) return null;
    const filename = decodeURIComponent(match[1]);
    if (!filename || filename === '.' || filename === '..') return null;
    const directory = path.resolve(process.cwd(), 'uploads', 'resumes');
    const filePath = path.resolve(directory, filename);
    return filePath.startsWith(`${directory}${path.sep}`) ? filePath : null;
  } catch {
    return null;
  }
};

const removeUnreferencedOldResume = async (resumeUrl, userId) => {
  const filePath = getLocalResumePath(resumeUrl);
  if (!filePath) return;
  try {
    const [otherUsers, applications] = await Promise.all([
      User.countDocuments({ resumeUrl, _id: { $ne: userId } }),
      Application.countDocuments({ 'candidateSnapshot.resumeUrl': resumeUrl }),
    ]);
    if (otherUsers === 0 && applications === 0) {
      await removeLocalFile(filePath, 'Could not remove replaced resume file');
    }
  } catch (error) {
    logger.warn('Could not check references to replaced resume file', error.message);
  }
};

const setStorageIds = async (userId, set, unset = {}) => {
  if (!userId || (!Object.keys(set).length && !Object.keys(unset).length)) return;
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  await User.findByIdAndUpdate(userId, update);
};

export const uploadController = {
  handleAvatarUpload: async (req, res, next) => {
    let newFileId = null;
    let profileUrlPersisted = false;
    let centralizedUpload = false;
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No avatar image uploaded' });
      const upload = await processUploadToCentralizedStorage(req, 'avatars');
      const { fileUrl, fileId } = upload;
      centralizedUpload = upload.centralizedUpload;
      newFileId = fileId;
      let updatedUser = null;
      if (req.user?.id) {
        const existing = (fileId || req.file.path)
          ? await User.findById(req.user.id).select('profileIconFileId').lean()
          : null;
        const oldFileId = existing?.profileIconFileId || null;
        updatedUser = await userService.updateProfile(req.user.id, { profileIcon: fileUrl });
        if (!updatedUser) {
          await removeNewUpload(req.file.path);
          await deleteOldFileFromStorage(newFileId, req.user.id);
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        profileUrlPersisted = true;
        if (fileId) await setStorageIds(req.user.id, { profileIconFileId: fileId });
        else if (oldFileId) await setStorageIds(req.user.id, {}, { profileIconFileId: 1 });
        if (oldFileId && oldFileId !== fileId) await deleteOldFileFromStorage(oldFileId, req.user.id);
      }
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      return res.status(201).json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          url: updatedUser?.profileIcon || fileUrl,
          profileIcon: updatedUser?.profileIcon || fileUrl,
          ...(fileId ? { fileId } : {}),
          ...(updatedUser ? { completionPercentage: updatedUser.completionPercentage } : {}),
          filename: req.file.filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      if (profileUrlPersisted) {
        await removeCentralizedUploadTempFile(req.file?.path, centralizedUpload);
      } else {
        await removeNewUpload(req.file?.path);
        if (newFileId) await deleteOldFileFromStorage(newFileId, req.user?.id);
      }
      return next(error);
    }
  },

  handleResumeUpload: async (req, res, next) => {
    let newFileId = null;
    let profileUrlPersisted = false;
    let centralizedUpload = false;
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No resume document uploaded' });
      if (!req.user?.id) {
        await removeNewUpload(req.file.path);
        return res.status(401).json({ success: false, message: 'Authentication is required to upload a resume' });
      }
      const existing = await User.findById(req.user.id).select('resumeUrl resumeFileId');
      if (!existing) {
        await removeNewUpload(req.file.path);
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      const upload = await processUploadToCentralizedStorage(req, 'resumes');
      const { fileUrl, fileId } = upload;
      centralizedUpload = upload.centralizedUpload;
      newFileId = fileId;
      const updatedUser = await userService.updateResume(req.user.id, fileUrl);
      if (!updatedUser) {
        await removeNewUpload(req.file.path);
        await deleteOldFileFromStorage(newFileId, req.user.id);
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      profileUrlPersisted = true;
      if (fileId) await setStorageIds(req.user.id, { resumeFileId: fileId });
      else if (existing.resumeFileId) await setStorageIds(req.user.id, {}, { resumeFileId: 1 });
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      if (existing.resumeFileId && existing.resumeFileId !== fileId) {
        await deleteOldFileFromStorage(existing.resumeFileId, req.user.id);
      }
      if (existing.resumeUrl && existing.resumeUrl !== updatedUser.resumeUrl) {
        await removeUnreferencedOldResume(existing.resumeUrl, req.user.id);
      }
      return res.status(201).json({
        success: true,
        message: 'Resume uploaded successfully',
        data: {
          url: fileUrl,
          ...(fileId ? { fileId } : {}),
          resumeUrl: updatedUser.resumeUrl,
          completionPercentage: updatedUser.completionPercentage,
          filename: req.file.filename,
          size: req.file.size,
        },
      });
    } catch (error) {
      if (profileUrlPersisted) {
        await removeCentralizedUploadTempFile(req.file?.path, centralizedUpload);
      } else {
        await removeNewUpload(req.file?.path);
        if (newFileId) await deleteOldFileFromStorage(newFileId, req.user?.id);
      }
      return next(error);
    }
  },

  handleCertificateUpload: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No certificate document uploaded' });
      const { fileUrl, fileId, centralizedUpload } = await processUploadToCentralizedStorage(req, 'certificates');
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      return res.status(201).json({ success: true, message: 'Certificate uploaded successfully', data: { url: fileUrl, ...(fileId ? { fileId } : {}), filename: req.file.filename } });
    } catch (error) {
      await removeNewUpload(req.file?.path);
      return next(error);
    }
  },

  handleLogoUpload: async (req, res, next) => {
    let newFileId = null;
    let profileUrlPersisted = false;
    let centralizedUpload = false;
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No logo image uploaded' });
      const upload = await processUploadToCentralizedStorage(req, 'company-logos');
      const { fileUrl, fileId } = upload;
      centralizedUpload = upload.centralizedUpload;
      newFileId = fileId;
      let updatedUser = null;
      let oldFileIds = [];
      if (req.user?.id) {
        const existing = await User.findById(req.user.id).select('companyProfile.logoFileId profileIconFileId').lean();
        oldFileIds = [...new Set([
          existing?.companyProfile?.logoFileId,
          existing?.profileIconFileId,
        ].filter(Boolean))];
        updatedUser = await userService.updateProfile(req.user.id, {
          companyProfile: { logo: fileUrl },
          profileIcon: fileUrl,
        });
        if (!updatedUser) {
          await removeNewUpload(req.file.path);
          await deleteOldFileFromStorage(newFileId, req.user.id);
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        profileUrlPersisted = true;
        if (fileId) {
          await setStorageIds(req.user.id, {
            'companyProfile.logoFileId': fileId,
            profileIconFileId: fileId,
          });
        } else {
          await setStorageIds(req.user.id, {}, {
            'companyProfile.logoFileId': 1,
            profileIconFileId: 1,
          });
        }
        for (const oldFileId of oldFileIds) {
          if (oldFileId !== fileId) await deleteOldFileFromStorage(oldFileId, req.user.id);
        }
      }
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      return res.status(201).json({
        success: true,
        message: 'Company logo uploaded successfully',
        data: { url: fileUrl, ...(fileId ? { fileId } : {}), ...(updatedUser ? { completionPercentage: updatedUser.completionPercentage } : {}), filename: req.file.filename },
      });
    } catch (error) {
      if (profileUrlPersisted) {
        await removeCentralizedUploadTempFile(req.file?.path, centralizedUpload);
      } else {
        await removeNewUpload(req.file?.path);
        if (newFileId) await deleteOldFileFromStorage(newFileId, req.user?.id);
      }
      return next(error);
    }
  },

  handleAttachmentUpload: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No attachment uploaded' });
      const { fileUrl, fileId, centralizedUpload } = await processUploadToCentralizedStorage(req, 'chat-attachments');
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      return res.status(201).json({ success: true, message: 'Chat attachment uploaded successfully', data: { url: fileUrl, ...(fileId ? { fileId } : {}), filename: req.file.filename, size: req.file.size, mimetype: req.file.mimetype } });
    } catch (error) {
      await removeNewUpload(req.file?.path);
      return next(error);
    }
  },

  handleInternshipPosterUpload: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No poster image uploaded' });
      const { fileUrl, fileId, centralizedUpload } = await processUploadToCentralizedStorage(req, 'internship-posters');
      await removeCentralizedUploadTempFile(req.file.path, centralizedUpload);
      return res.status(201).json({ success: true, message: 'Internship poster uploaded successfully', data: { url: fileUrl, ...(fileId ? { fileId } : {}), filename: req.file.filename, size: req.file.size, mimetype: req.file.mimetype } });
    } catch (error) {
      await removeNewUpload(req.file?.path);
      return next(error);
    }
  },
};

export default uploadController;
