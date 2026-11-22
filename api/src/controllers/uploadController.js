import fs from 'node:fs/promises';
import path from 'node:path';
import { formatFileUrl } from '../services/uploadService.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { logger } from '../utils/logger.js';
import { userService } from '../services/userService.js';

const removeNewUpload = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Could not remove failed upload file', error.message);
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
    const resumeDirectory = path.resolve(process.cwd(), 'uploads', 'resumes');
    const filePath = path.resolve(resumeDirectory, filename);
    return filePath.startsWith(`${resumeDirectory}${path.sep}`) ? filePath : null;
  } catch {
    return null;
  }
};

const removeUnreferencedOldResume = async (resumeUrl, userId) => {
  const filePath = getLocalResumePath(resumeUrl);
  if (!filePath) return;

  try {
    const otherReferences = await User.countDocuments({
      resumeUrl,
      _id: { $ne: userId },
    });
    const applicationReferences = await Application.countDocuments({
      'candidateSnapshot.resumeUrl': resumeUrl,
    });
    if (otherReferences > 0 || applicationReferences > 0) return;
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Could not remove replaced resume file', error.message);
  }
};

export const uploadController = {
  // Upload user avatar & optionally attach to profileIcon
  handleAvatarUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No avatar image uploaded' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'avatars');

      const updatedUser = await userService.updateProfile(req.user.id, { profileIcon: fileUrl });

      if (!updatedUser) {
        await removeNewUpload(req.file.path);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      res.status(201).json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          url: fileUrl,
          profileIcon: updatedUser.profileIcon,
          completionPercentage: updatedUser.completionPercentage,
          filename: req.file.filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      await removeNewUpload(req.file?.path);
      next(error);
    }
  },

  // Upload candidate resume & optionally attach to resumeUrl
  handleResumeUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No resume document uploaded' });
      }

      if (!req.user?.id) {
        await removeNewUpload(req.file.path);
        return res.status(401).json({ success: false, message: 'Authentication is required to upload a resume' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'resumes');
      const existingUser = await User.findById(req.user.id).select('resumeUrl');
      if (!existingUser) {
        await removeNewUpload(req.file.path);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const updatedUser = await userService.updateResume(req.user.id, fileUrl);

      if (!updatedUser) {
        await removeNewUpload(req.file.path);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (existingUser.resumeUrl && existingUser.resumeUrl !== updatedUser.resumeUrl) {
        await removeUnreferencedOldResume(existingUser.resumeUrl, req.user.id);
      }

      res.status(201).json({
        success: true,
        message: 'Resume uploaded successfully',
        data: {
          url: fileUrl,
          resumeUrl: updatedUser.resumeUrl,
          completionPercentage: updatedUser.completionPercentage,
          filename: req.file.filename,
          size: req.file.size,
        },
      });
    } catch (error) {
      await removeNewUpload(req.file?.path);
      next(error);
    }
  },

  // Upload certification proof document
  handleCertificateUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No certificate document uploaded' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'certificates');

      res.status(201).json({
        success: true,
        message: 'Certificate uploaded successfully',
        data: {
          url: fileUrl,
          filename: req.file.filename,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Upload company brand logo
  handleLogoUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No logo image uploaded' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'company-logos');

      let updatedUser = null;
      if (req.user?.id) {
        updatedUser = await userService.updateProfile(req.user.id, {
          companyProfile: { logo: fileUrl },
        });
      }

      res.status(201).json({
        success: true,
        message: 'Company logo uploaded successfully',
        data: {
          url: fileUrl,
          ...(updatedUser ? { completionPercentage: updatedUser.completionPercentage } : {}),
          filename: req.file.filename,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Upload chat attachment
  handleAttachmentUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No attachment uploaded' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'chat-attachments');

      res.status(201).json({
        success: true,
        message: 'Chat attachment uploaded successfully',
        data: {
          url: fileUrl,
          filename: req.file.filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Upload internship poster image
  handleInternshipPosterUpload: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No poster image uploaded' });
      }

      const fileUrl = formatFileUrl(req, req.file, 'internship-posters');

      res.status(201).json({
        success: true,
        message: 'Internship poster uploaded successfully',
        data: {
          url: fileUrl,
          filename: req.file.filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
