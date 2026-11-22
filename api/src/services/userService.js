import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { generateOtp } from '../utils/otp.js';
import { emailService } from './emailService.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { OtpVerification } from '../models/OtpVerification.js';
import { sanitizeProfileUpdate } from '../utils/profileUpdateSanitizer.js';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds between resends
const MAX_OTP_ATTEMPTS = 5;
const MAX_RESENDS_WINDOW = 5;
const RESEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Use positive projections for profile reads so newly added account/security
// fields are never exposed by these APIs by default.
const AUTHENTICATED_PROFILE_FIELDS = [
  'name email phone role roleTag displayOrder headline bio dob location profileIcon',
  'college course branch graduationYear experienceLevel',
  'skills primarySkills projects certifications achievements metrics reputationScore topPercentile',
  'completionPercentage resumeUrl portfolioUrl githubUrl linkedinUrl openToWorkMessage',
  'companyProfile collegeProfile notificationPreferences privacyPreferences createdAt updatedAt',
].join(' ');

const PUBLIC_PROFILE_FIELDS = [
  '_id name role roleTag headline bio location profileIcon',
  'college course branch graduationYear experienceLevel skills primarySkills projects certifications',
  'achievements metrics reputationScore topPercentile completionPercentage portfolioUrl',
  'githubUrl linkedinUrl openToWorkMessage createdAt updatedAt',
  'companyProfile.companyName companyProfile.logo companyProfile.tagline companyProfile.aboutCompany',
  'companyProfile.establishedYear companyProfile.industryType companyProfile.companySize',
  'companyProfile.website companyProfile.linkedin companyProfile.awards companyProfile.certifications',
  'collegeProfile.collegeName collegeProfile.aboutCollege collegeProfile.establishedYear',
  'collegeProfile.collegeType collegeProfile.pincode collegeProfile.departments collegeProfile.courses',
  'collegeProfile.numberOfStudents collegeProfile.numberOfDepartments collegeProfile.placementRate',
  'collegeProfile.studentsPlaced collegeProfile.companiesVisited collegeProfile.highestPackage',
  'collegeProfile.averagePackage collegeProfile.internshipParticipation collegeProfile.website collegeProfile.linkedin',
].join(' ');

export const DIRECTORY_PROFILE_FIELDS = [
  '_id name role roleTag headline bio location profileIcon',
  'college course branch graduationYear experienceLevel skills primarySkills projects certifications',
  'achievements metrics reputationScore topPercentile completionPercentage portfolioUrl githubUrl linkedinUrl',
  'openToWorkMessage createdAt updatedAt',
  'companyProfile.companyName companyProfile.tagline companyProfile.industryType companyProfile.companySize',
  'companyProfile.website companyProfile.logo collegeProfile.collegeName collegeProfile.collegeType',
  'collegeProfile.website collegeProfile.logo',
].join(' ');

const DIRECTORY_PROFILE_FIELD_NAMES = new Set(DIRECTORY_PROFILE_FIELDS.split(/\s+/));
const DIRECTORY_SKILL_FIELDS = new Set(['name', 'level', 'endorsedCount']);
const DIRECTORY_PROJECT_FIELDS = new Set(['id', 'title', 'description', 'tags', 'verified', 'repoUrl', 'liveUrl']);
const DIRECTORY_METRIC_FIELDS = new Set(['label', 'value', 'color']);
const DIRECTORY_CERTIFICATION_FIELDS = new Set(['name', 'issuingOrganization', 'validationDate', 'isVerified']);
const DIRECTORY_ACHIEVEMENT_FIELDS = new Set(['achievement', 'year']);
const sanitizeDirectoryItems = (items, allowedFields) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => Object.fromEntries(
      Object.entries(item).filter(([field]) => allowedFields.has(field))
    ));
};

export const sanitizeDirectoryUser = (user) => {
  const source = typeof user?.toObject === 'function' ? user.toObject() : user;
  if (!source || typeof source !== 'object') return source;

  const sanitized = Object.fromEntries(
    Object.entries(source).filter(([field]) => DIRECTORY_PROFILE_FIELD_NAMES.has(field))
  );
  for (const group of ['companyProfile', 'collegeProfile']) {
    if (!source[group] || typeof source[group] !== 'object') continue;
    const nestedFields = [...DIRECTORY_PROFILE_FIELD_NAMES]
      .filter((field) => field.startsWith(`${group}.`))
      .map((field) => field.slice(group.length + 1));
    sanitized[group] = Object.fromEntries(
      Object.entries(source[group]).filter(([field]) => nestedFields.includes(field))
    );
  }
  if ('skills' in source) {
    sanitized.skills = sanitizeDirectoryItems(source.skills, DIRECTORY_SKILL_FIELDS);
  }
  if ('projects' in source) {
    sanitized.projects = sanitizeDirectoryItems(source.projects, DIRECTORY_PROJECT_FIELDS);
  }
  if ('metrics' in source) {
    sanitized.metrics = sanitizeDirectoryItems(source.metrics, DIRECTORY_METRIC_FIELDS);
  }
  if ('certifications' in source) {
    sanitized.certifications = sanitizeDirectoryItems(source.certifications, DIRECTORY_CERTIFICATION_FIELDS);
  }
  if ('achievements' in source) {
    sanitized.achievements = sanitizeDirectoryItems(source.achievements, DIRECTORY_ACHIEVEMENT_FIELDS);
  }
  return sanitized;
};

const PUBLIC_PROFILE_FIELD_NAMES = new Set(PUBLIC_PROFILE_FIELDS.split(/\s+/));
const PUBLIC_COMPANY_PROFILE_FIELDS = new Set([
  'companyName', 'logo', 'tagline', 'aboutCompany', 'establishedYear',
  'industryType', 'companySize', 'website', 'linkedin', 'awards', 'certifications',
]);
const PUBLIC_COMPANY_AWARD_FIELDS = new Set(['name', 'receivedYear', 'category']);
const PUBLIC_COMPANY_CERTIFICATION_FIELDS = new Set(['name', 'issuingBody', 'validationDate']);
const PUBLIC_COLLEGE_PROFILE_FIELDS = new Set([
  'collegeName', 'aboutCollege', 'establishedYear', 'collegeType', 'departments', 'courses',
  'numberOfStudents', 'numberOfDepartments', 'placementRate', 'studentsPlaced',
  'companiesVisited', 'highestPackage', 'averagePackage', 'internshipParticipation',
  'website', 'linkedin',
]);

const sanitizeStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

const sanitizePublicProfile = (profile) => {
  const source = typeof profile?.toObject === 'function' ? profile.toObject() : profile;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;

  const sanitized = Object.fromEntries(
    Object.entries(source).filter(([field]) => PUBLIC_PROFILE_FIELD_NAMES.has(field))
  );
  for (const [field, allowedFields] of [
    ['skills', DIRECTORY_SKILL_FIELDS],
    ['projects', DIRECTORY_PROJECT_FIELDS],
    ['metrics', DIRECTORY_METRIC_FIELDS],
    ['certifications', DIRECTORY_CERTIFICATION_FIELDS],
    ['achievements', DIRECTORY_ACHIEVEMENT_FIELDS],
  ]) {
    if (field in source) sanitized[field] = sanitizeDirectoryItems(source[field], allowedFields);
  }
  if ('primarySkills' in source) sanitized.primarySkills = sanitizeStringArray(source.primarySkills);

  if (source.companyProfile && typeof source.companyProfile === 'object' && !Array.isArray(source.companyProfile)) {
    const company = Object.fromEntries(
      Object.entries(source.companyProfile).filter(([field]) => PUBLIC_COMPANY_PROFILE_FIELDS.has(field))
    );
    if ('awards' in company) company.awards = sanitizeDirectoryItems(company.awards, PUBLIC_COMPANY_AWARD_FIELDS);
    if ('certifications' in company) {
      company.certifications = sanitizeDirectoryItems(company.certifications, PUBLIC_COMPANY_CERTIFICATION_FIELDS);
    }
    sanitized.companyProfile = company;
  }
  if (source.collegeProfile && typeof source.collegeProfile === 'object' && !Array.isArray(source.collegeProfile)) {
    sanitized.collegeProfile = Object.fromEntries(
      Object.entries(source.collegeProfile)
        .filter(([field]) => PUBLIC_COLLEGE_PROFILE_FIELDS.has(field))
        .map(([field, value]) => [
          field,
          ['departments', 'courses'].includes(field) ? sanitizeStringArray(value) : value,
        ])
    );
  }
  return sanitized;
};

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasItems = (value, predicate = (item) => Boolean(item)) =>
  Array.isArray(value) && value.some(predicate);
const hasNamedItem = (value, field) => hasItems(value, (item) => hasText(item?.[field]));

const weightedCompletion = (criteria) => {
  const total = criteria.reduce((score, [weight, complete]) => score + (complete ? weight : 0), 0);
  return Math.max(0, Math.min(100, Math.round(total)));
};

/** Calculate a whole-profile completion score using the user's applicable profile fields. */
export const calculateProfileCompletion = (profile = {}) => {
  const role = String(profile.role || 'student').toLowerCase();

  // Company and college accounts use the fields relevant to their profile types.
  if (role === 'company') {
    const company = profile.companyProfile || {};
    return weightedCompletion([
      [10, hasText(profile.name)],
      [10, hasText(company.companyName)],
      [10, hasText(company.tagline)],
      [20, hasText(company.aboutCompany)],
      [5, hasText(profile.location)],
      [5, hasText(company.logo)],
      [5, Number(company.establishedYear) > 0],
      [10, hasText(company.industryType)],
      [10, hasText(company.companySize)],
      [5, hasText(company.website)],
      [5, hasText(company.linkedin)],
      [5, hasNamedItem(company.awards, 'name') || hasNamedItem(company.certifications, 'name')],
    ]);
  }

  if (role === 'college') {
    const college = profile.collegeProfile || {};
    return weightedCompletion([
      [10, hasText(profile.name)],
      [10, hasText(college.collegeName)],
      [15, hasText(college.aboutCollege)],
      [5, hasText(profile.profileIcon)],
      [5, hasText(profile.location)],
      [5, Number(college.establishedYear) > 0],
      [10, hasText(college.collegeType)],
      [5, hasText(college.pincode)],
      [10, hasItems(college.departments, hasText)],
      [10, hasItems(college.courses, hasText)],
      [5, hasText(college.website)],
      [5, hasText(college.linkedin)],
      [5, Number(college.numberOfStudents) > 0],
    ]);
  }

  const hasEducation = [profile.college, profile.course, profile.branch].map(hasText);
  return weightedCompletion([
    [10, hasText(profile.name)],
    [10, hasText(profile.headline)],
    [10, hasText(profile.bio)],
    [5, hasText(profile.location)],
    [5, hasText(profile.profileIcon)],
    [5, hasEducation[0]],
    [5, hasEducation[1]],
    [5, hasEducation[2]],
    [5, Number(profile.graduationYear) > 0],
    [10, hasNamedItem(profile.skills, 'name') || hasItems(profile.primarySkills, hasText)],
    [10, hasNamedItem(profile.projects, 'title')],
    [10, hasText(profile.resumeUrl)],
    [5, hasText(profile.portfolioUrl) || hasText(profile.githubUrl) || hasText(profile.linkedinUrl)],
    [5, hasNamedItem(profile.certifications, 'name') || hasNamedItem(profile.achievements, 'achievement')],
  ]);
};

const mergeProfileUpdate = (currentProfile, updateData) => {
  const merged = { ...currentProfile };
  for (const [path, value] of Object.entries(updateData)) {
    const segments = path.split('.');
    let target = merged;
    for (const segment of segments.slice(0, -1)) {
      target[segment] = { ...(target[segment] || {}) };
      target = target[segment];
    }
    target[segments.at(-1)] = value;
  }
  return merged;
};

const preserveTrustedMetadataForUnchangedItems = (updateData, currentProfile) => {
  const preserve = (submittedItems, existingItems, identityFields, trustedFields) => {
    if (!Array.isArray(submittedItems) || !Array.isArray(existingItems)) return submittedItems;
    const normalizeIdentity = (field, value) => {
      if (value == null) return null;
      if (field === 'validationDate') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
      if (['year', 'receivedYear'].includes(field) && value !== '') return Number(value);
      return JSON.stringify(value);
    };
    return submittedItems.map((submitted) => {
      const existing = existingItems.find((candidate) => identityFields.every((field) =>
        normalizeIdentity(field, candidate?.[field]) === normalizeIdentity(field, submitted?.[field])
      ));
      if (!existing) return submitted;
      const result = { ...submitted };
      for (const field of trustedFields) {
        if (existing[field] !== undefined) result[field] = existing[field];
      }
      return result;
    });
  };

  for (const [field, identityFields, trustedFields] of [
    ['skills', ['name', 'level'], ['endorsedCount']],
    ['projects', ['id', 'title', 'description', 'tags', 'repoUrl', 'liveUrl'], ['verified']],
    ['certifications', ['name', 'issuingOrganization', 'validationDate'], ['isVerified', 'certificateFile']],
    ['achievements', ['achievement', 'year'], ['proofFile']],
  ]) {
    if (updateData[field] !== undefined) {
      updateData[field] = preserve(updateData[field], currentProfile[field], identityFields, trustedFields);
    }
  }

  for (const [field, identityFields] of [
    ['awards', ['name', 'receivedYear', 'category']],
    ['certifications', ['name', 'issuingBody', 'validationDate']],
  ]) {
    const updatePath = `companyProfile.${field}`;
    if (updateData[updatePath] !== undefined) {
      updateData[updatePath] = preserve(
        updateData[updatePath],
        currentProfile.companyProfile?.[field],
        identityFields,
        ['certificateFile']
      );
    }
  }
};

const synchronizeCompletion = async (user, persist = false) => {
  const profile = typeof user.toObject === 'function' ? user.toObject() : user;
  const completionPercentage = calculateProfileCompletion(profile);
  if (Number(user.completionPercentage) !== completionPercentage) {
    user.completionPercentage = completionPercentage;
    if (persist && typeof user.save === 'function') await user.save();
  }
  return user;
};

const hashOtp = (otp) => {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
};

const getJwtSecrets = () => {
  const jwtSecret = process.env.JWT_SECRET || 'dev_secret_key_showmyskills_2026';
  const refreshSecret =
    process.env.JWT_REFRESH_SECRET || `${jwtSecret}_refresh_showmyskills_secret`;
  return { jwtSecret, refreshSecret };
};

export const generateTokenPair = async (user) => {
  const { jwtSecret, refreshSecret } = getJwtSecrets();

  const accessToken = jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      roleTag: user.roleTag,
    },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      sub: user._id.toString(),
      type: 'refresh',
      jti: Math.random().toString(36).substring(2) + Date.now().toString(36),
    },
    refreshSecret,
    { expiresIn: '7d' }
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Retain only valid tokens and append new refresh token (max 10 sessions)
  const validTokens = (user.refreshTokens || []).filter((t) => t.expiresAt > now);
  validTokens.push({ token: refreshToken, expiresAt, createdAt: now });
  user.refreshTokens = validTokens.slice(-10);

  await user.save();

  return {
    accessToken,
    refreshToken,
    token: accessToken, // backward compatibility
  };
};

export const userService = {
  authenticate: async (email, password, role = null) => {
    if (!email || !password) {
      const error = new Error('Email and password are required');
      error.statusCode = 400;
      throw error;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Pre-check database readiness to avoid hanging on disconnected cluster
    if (mongoose.connection.readyState !== 1) {
      const error = new Error('Database service is temporarily unavailable');
      error.statusCode = 503;
      error.isDatabaseError = true;
      throw error;
    }

    let user;
    try {
      user = await User.findOne({ email: normalizedEmail });
    } catch (dbErr) {
      if (
        dbErr.name === 'MongoServerSelectionError' ||
        dbErr.name === 'MongoNetworkError' ||
        dbErr.name === 'MongoTimeoutError' ||
        dbErr.message?.includes('timed out') ||
        dbErr.message?.includes('ECONNREFUSED')
      ) {
        const error = new Error('Database service is temporarily unavailable');
        error.statusCode = 503;
        error.isDatabaseError = true;
        error.originalError = dbErr;
        throw error;
      }
      throw dbErr;
    }

    if (!user) {
      const error = new Error('Email or password is incorrect.');
      error.statusCode = 401;
      throw error;
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      const error = new Error('Email or password is incorrect.');
      error.statusCode = 401;
      throw error;
    }

    if (role) {
      const expectedRole = String(role).trim().toLowerCase();
      const actualRole = String(user.role || '').trim().toLowerCase();
      if (actualRole !== expectedRole) {
        const article = expectedRole === 'admin' ? 'an' : 'a';
        const roleLabel = expectedRole.charAt(0).toUpperCase() + expectedRole.slice(1);
        const error = new Error(
          `This account is not registered as ${article} ${roleLabel} account. Choose the correct account type.`
        );
        error.statusCode = 403;
        error.code = 'ROLE_MISMATCH';
        throw error;
      }
    }

    const tokens = await generateTokenPair(user);

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.emailVerificationOtp;
    delete userObj.emailVerificationOtpExpires;
    delete userObj.passwordResetOtp;
    delete userObj.passwordResetOtpExpires;

    return {
      id: user._id.toString(),
      ...userObj,
      ...tokens,
    };
  },

  refreshAccessToken: async (refreshToken) => {
    if (!refreshToken) {
      const error = new Error('Refresh token is required');
      error.statusCode = 400;
      throw error;
    }

    const { refreshSecret } = getJwtSecrets();

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
    } catch (err) {
      const error = new Error('Invalid or expired refresh token');
      error.statusCode = 401;
      error.code = 'REFRESH_TOKEN_EXPIRED';
      throw error;
    }

    const user = await User.findById(decoded.sub);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const tokenRecordIndex = (user.refreshTokens || []).findIndex(
      (t) => t.token === refreshToken && t.expiresAt > new Date()
    );

    if (tokenRecordIndex === -1) {
      const error = new Error('Refresh token has been revoked or expired');
      error.statusCode = 401;
      error.code = 'REFRESH_TOKEN_REVOKED';
      throw error;
    }

    // Remove consumed refresh token for rotation
    user.refreshTokens.splice(tokenRecordIndex, 1);

    const tokens = await generateTokenPair(user);

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.emailVerificationOtp;
    delete userObj.emailVerificationOtpExpires;
    delete userObj.passwordResetOtp;
    delete userObj.passwordResetOtpExpires;

    return {
      ...tokens,
      user: {
        id: user._id.toString(),
        ...userObj,
      },
    };
  },

  revokeRefreshToken: async (refreshToken) => {
    if (!refreshToken) return;
    const { refreshSecret } = getJwtSecrets();

    try {
      const decoded = jwt.verify(refreshToken, refreshSecret);
      await User.findByIdAndUpdate(decoded.sub, {
        $pull: { refreshTokens: { token: refreshToken } },
      });
    } catch {
      await User.updateMany(
        { 'refreshTokens.token': refreshToken },
        { $pull: { refreshTokens: { token: refreshToken } } }
      );
    }
  },

  createUser: async (userData) => {
    const {
      name,
      email,
      phone,
      password,
      role = 'student',
      college = '',
      graduationYear = null,
      collegeId = '',
      collegeIdDocument = null,
      companyName = '',
      website = '',
      collegeName = '',
      verificationToken = null,
    } = userData;

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 409;
      throw error;
    }

    let isEmailPreVerified = false;
    if (verificationToken) {
      const otpRecord = await OtpVerification.findOne({
        target: normalizedEmail,
        type: 'signup_email',
        verified: true,
        verificationToken,
        used: false,
      });
      if (otpRecord) {
        isEmailPreVerified = true;
        otpRecord.used = true;
        await otpRecord.save();
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const userPayload = {
      name: name || companyName || collegeName || 'New User',
      email: normalizedEmail,
      phone: phone || '',
      password: hashedPassword,
      role,
      roleTag: role === 'admin' ? 'Admin' : 'Regular',
      college: college || collegeName || '',
      graduationYear: graduationYear ? Number(graduationYear) : null,
      collegeId,
      collegeIdDocument,
      emailVerified: isEmailPreVerified,
      emailVerificationOtp: isEmailPreVerified ? null : otp,
      emailVerificationOtpExpires: isEmailPreVerified ? null : otpExpiresAt,
    };

    if (role === 'company') {
      userPayload.companyProfile = {
        companyName: companyName || name,
        website: website || '',
      };
    } else if (role === 'college') {
      userPayload.collegeProfile = {
        collegeName: collegeName || name,
        website: website || '',
      };
    }

    userPayload.completionPercentage = calculateProfileCompletion(userPayload);

    const user = await User.create(userPayload);

    if (!isEmailPreVerified) {
      try {
        await emailService.sendVerificationOtp(normalizedEmail, otp);
      } catch (e) {
        console.warn('Email dispatch failed, continuing:', e.message);
      }
    }

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationOtp;
    delete userResponse.emailVerificationOtpExpires;

    if (isEmailPreVerified) {
      const tokens = await generateTokenPair(user);
      return {
        ...userResponse,
        ...tokens,
        token: tokens.accessToken,
        user: userResponse,
      };
    }

    return userResponse;
  },

  sendSignupOtp: async (email) => {
    if (!email || !email.includes('@')) {
      const err = new Error('A valid email address is required');
      err.statusCode = 400;
      throw err;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const err = new Error('Email is already registered. Please log in.');
      err.statusCode = 409;
      throw err;
    }

    const existingOtp = await OtpVerification.findOne({
      target: normalizedEmail,
      type: 'signup_email',
    });

    const now = new Date();

    if (existingOtp) {
      const elapsedSinceLastSend = now.getTime() - existingOtp.lastSentAt.getTime();
      if (elapsedSinceLastSend < RATE_LIMIT_COOLDOWN_MS) {
        const remainingSec = Math.ceil(
          (RATE_LIMIT_COOLDOWN_MS - elapsedSinceLastSend) / 1000
        );
        const err = new Error(
          `Please wait ${remainingSec} seconds before requesting a new code.`
        );
        err.statusCode = 429;
        throw err;
      }

      const isWithinResendWindow =
        now.getTime() - existingOtp.updatedAt.getTime() < RESEND_WINDOW_MS;
      if (isWithinResendWindow && existingOtp.resendCount >= MAX_RESENDS_WINDOW) {
        const err = new Error(
          'Maximum resend attempts reached. Please try again after 15 minutes.'
        );
        err.statusCode = 429;
        throw err;
      }
    }

    const plainOtp = generateOtp();
    const otpHash = hashOtp(plainOtp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await OtpVerification.findOneAndUpdate(
      { target: normalizedEmail, type: 'signup_email' },
      {
        otpHash,
        expiresAt,
        attempts: 0,
        resendCount: existingOtp ? existingOtp.resendCount + 1 : 1,
        lastSentAt: now,
        verified: false,
        verifiedAt: null,
        used: false,
        verificationToken: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await emailService.sendVerificationOtp(normalizedEmail, plainOtp);
    } catch (e) {
      console.warn('[UserService] Email dispatch failed, continuing:', e.message);
    }

    return {
      success: true,
      message: 'Verification code sent to your email address.',
    };
  },

  verifySignupOtp: async (email, otp) => {
    if (!email || !otp) {
      const err = new Error('Email and verification code are required');
      err.statusCode = 400;
      throw err;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = await OtpVerification.findOne({
      target: normalizedEmail,
      type: 'signup_email',
    });

    if (!record) {
      const err = new Error('No OTP found. Please request a new verification code.');
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();

    if (record.expiresAt < now) {
      const err = new Error('Verification code has expired. Please request a new code.');
      err.statusCode = 400;
      throw err;
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      const err = new Error('Too many failed attempts. Code invalidated. Please request a new code.');
      err.statusCode = 400;
      throw err;
    }

    const inputHash = hashOtp(cleanOtp);
    if (inputHash !== record.otpHash) {
      record.attempts += 1;
      await record.save();
      const remainingAttempts = Math.max(0, MAX_OTP_ATTEMPTS - record.attempts);
      const err = new Error(
        remainingAttempts > 0
          ? `Invalid verification code. ${remainingAttempts} attempts remaining.`
          : 'Invalid verification code. Maximum attempts reached. Please request a new code.'
      );
      err.statusCode = 400;
      throw err;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    record.verified = true;
    record.verifiedAt = now;
    record.verificationToken = verificationToken;
    await record.save();

    return {
      success: true,
      message: 'Email verified successfully.',
      verificationToken,
    };
  },

  verifyEmailOtp: async (email, otp) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (!user.emailVerificationOtp) {
      const error = new Error('No OTP found. Please request a new OTP.');
      error.statusCode = 400;
      throw error;
    }

    if (user.emailVerificationOtp !== String(otp)) {
      const error = new Error('Invalid OTP');
      error.statusCode = 400;
      throw error;
    }

    if (!user.emailVerificationOtpExpires || user.emailVerificationOtpExpires < new Date()) {
      const error = new Error('OTP has expired');
      error.statusCode = 400;
      throw error;
    }

    user.emailVerified = true;
    user.emailVerificationOtp = null;
    user.emailVerificationOtpExpires = null;

    const tokens = await generateTokenPair(user);

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.refreshTokens;
    delete userResponse.emailVerificationOtp;
    delete userResponse.emailVerificationOtpExpires;

    return {
      ...userResponse,
      ...tokens,
    };
  },

  sendPasswordResetOtp: async (email) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const error = new Error('No account found with this email address');
      error.statusCode = 404;
      throw error;
    }

    const otp = generateOtp();
    user.passwordResetOtp = otp;
    user.passwordResetOtpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    try {
      await emailService.sendVerificationOtp(normalizedEmail, otp);
    } catch (e) {
      console.warn('Password reset email dispatch warning:', e.message);
    }

    return { success: true, message: 'Password recovery OTP sent to your email.' };
  },

  verifyPasswordResetOtp: async (email, otp) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (!user.passwordResetOtp || user.passwordResetOtp !== String(otp)) {
      const error = new Error('Invalid or expired OTP code');
      error.statusCode = 400;
      throw error;
    }

    if (user.passwordResetOtpExpires && user.passwordResetOtpExpires < new Date()) {
      const error = new Error('OTP code has expired. Please request a new one.');
      error.statusCode = 400;
      throw error;
    }

    return { success: true, message: 'OTP verified successfully.' };
  },

  resetPassword: async (email, otp, newPassword) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (!user.passwordResetOtp || user.passwordResetOtp !== String(otp)) {
      const error = new Error('Invalid or expired OTP code');
      error.statusCode = 400;
      throw error;
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
    await user.save();

    return { success: true, message: 'Password updated successfully. You can now log in.' };
  },

  getCurrentUserById: async (userId) => {
    const user = await User.findById(userId).select(AUTHENTICATED_PROFILE_FIELDS);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    return synchronizeCompletion(user, true);
  },

  getUserById: async (userId) => {
    // Resume URL is loaded only to calculate the complete score; omit it from
    // the returned public profile object.
    const user = await User.findById(userId).select(`${PUBLIC_PROFILE_FIELDS} resumeUrl`);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    await synchronizeCompletion(user);
    return sanitizePublicProfile(user);
  },

  updateProfile: async (userId, data) => {
    const safeData = sanitizeProfileUpdate(data);
    const allowedFields = [
      'name',
      'headline',
      'bio',
      'location',
      'phone',
      'dob',
      'profileIcon',
      'college',
      'course',
      'branch',
      'graduationYear',
      'experienceLevel',
      'skills',
      'primarySkills',
      'projects',
      'certifications',
      'achievements',
      'portfolioUrl',
      'githubUrl',
      'linkedinUrl',
      'companyProfile',
      'collegeProfile',
      'openToWorkMessage',
      'notificationPreferences',
      'privacyPreferences',
      'twoFactorEnabled',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (safeData[key] !== undefined) {
        updateData[key] = safeData[key];
      }
    }

    // Flatten nested groups into dotted updates so omitted sibling values remain intact.
    for (const field of [
      'companyProfile',
      'collegeProfile',
      'notificationPreferences',
      'privacyPreferences',
    ]) {
      if (safeData[field] && typeof safeData[field] === 'object' && !Array.isArray(safeData[field])) {
        delete updateData[field];
        for (const [subKey, subVal] of Object.entries(safeData[field])) {
          updateData[`${field}.${subKey}`] = subVal;
        }
      }
    }

    if (safeData.logo !== undefined) {
      updateData['companyProfile.logo'] = safeData.logo;
      updateData.profileIcon = safeData.logo;
    } else if (safeData.companyProfile?.logo !== undefined) {
      updateData.profileIcon = safeData.companyProfile.logo;
    }

    const yearVal = safeData.establishedYear !== undefined ? safeData.establishedYear : safeData.establishmentYear;
    if (yearVal !== undefined) {
      updateData['companyProfile.establishedYear'] = yearVal ? Number(yearVal) : null;
    }
    const sizeVal = safeData.companySize !== undefined ? safeData.companySize : safeData.teamSize;
    if (sizeVal !== undefined) {
      updateData['companyProfile.companySize'] = sizeVal ? String(sizeVal).trim() : '';
    }

    if (safeData.github !== undefined && updateData.githubUrl === undefined) updateData.githubUrl = safeData.github;
    if (safeData.linkedin !== undefined && updateData.linkedinUrl === undefined) updateData.linkedinUrl = safeData.linkedin;
    if (safeData.department !== undefined && updateData.branch === undefined) updateData.branch = safeData.department;
    if (safeData.about !== undefined && updateData.bio === undefined) updateData.bio = safeData.about;
    if (safeData.collegeName !== undefined && updateData.college === undefined) updateData.college = safeData.collegeName;
    if (safeData.gradYear !== undefined && safeData.gradYear !== '' && updateData.graduationYear === undefined) {
      updateData.graduationYear = Number(safeData.gradYear);
    }

    // If password change is requested in profile/settings
    const currentPass = safeData.currentPassword || safeData.passwords?.current;
    const newPass = safeData.newPassword || safeData.passwords?.newPass;
    if (currentPass && newPass) {
      const user = await User.findById(userId);
      const matches = await bcrypt.compare(currentPass, user.password);
      if (!matches) {
        const error = new Error('Current password is incorrect');
        error.statusCode = 400;
        throw error;
      }
      if (newPass.length < 6) {
        const error = new Error('New password must be at least 6 characters');
        error.statusCode = 400;
        throw error;
      }
      user.password = await bcrypt.hash(newPass, 10);
      await user.save();
    }

    const currentProfile = await User.findById(userId).select(AUTHENTICATED_PROFILE_FIELDS);
    if (!currentProfile) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const currentProfileData = typeof currentProfile.toObject === 'function'
      ? currentProfile.toObject()
      : currentProfile;
    preserveTrustedMetadataForUnchangedItems(updateData, currentProfileData);
    const resultingProfile = mergeProfileUpdate(currentProfileData, updateData);
    updateData.completionPercentage = calculateProfileCompletion(resultingProfile);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select(
      AUTHENTICATED_PROFILE_FIELDS
    );

    return updatedUser;
  },

  updateResume: async (userId, resumeUrl) => {
    const user = await User.findById(userId).select(AUTHENTICATED_PROFILE_FIELDS);
    if (!user) return null;

    const currentProfile = typeof user.toObject === 'function' ? user.toObject() : user;
    const completionPercentage = calculateProfileCompletion({ ...currentProfile, resumeUrl });
    return User.findByIdAndUpdate(
      userId,
      { $set: { resumeUrl, completionPercentage } },
      { new: true, runValidators: true }
    ).select(AUTHENTICATED_PROFILE_FIELDS);
  },

  updateSettings: async (userId, data) => {
    const updateData = {};
    if (data.notificationPreferences) {
      updateData.notificationPreferences = data.notificationPreferences;
    }
    if (data.privacyPreferences) {
      updateData.privacyPreferences = data.privacyPreferences;
    }
    if (data.twoFactorEnabled !== undefined) {
      updateData.twoFactorEnabled = data.twoFactorEnabled;
    }

    if (data.newPassword && data.currentPassword) {
      const user = await User.findById(userId);
      const matches = await bcrypt.compare(data.currentPassword, user.password);
      if (!matches) {
        const error = new Error('Current password is incorrect');
        error.statusCode = 400;
        throw error;
      }
      user.password = await bcrypt.hash(data.newPassword, 10);
      await user.save();
    }

    const updatedUser = await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true }).select(
      AUTHENTICATED_PROFILE_FIELDS
    );

    return updatedUser;
  },

  searchUsers: async ({ search = '', role = 'student', roleTag, college, skill, page = 1, limit = 20 }) => {
    const filter = { role };

    if (roleTag && roleTag !== 'All') {
      filter.roleTag = roleTag;
    }

    if (college) {
      filter.college = new RegExp(college, 'i');
    }

    if (skill) {
      filter['skills.name'] = new RegExp(skill, 'i');
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { name: regex },
        { college: regex },
        { headline: regex },
        { 'skills.name': regex },
        { branch: regex },
      ];
    }

    const skip = (Math.max(1, page) - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(DIRECTORY_PROFILE_FIELDS)
        .sort({ displayOrder: 1, createdAt: 1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    return {
      users: users.map(sanitizeDirectoryUser),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

};
