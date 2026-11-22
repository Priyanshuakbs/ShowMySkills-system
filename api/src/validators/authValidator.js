import { sanitizeProfileUpdate } from '../utils/profileUpdateSanitizer.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required',
    });
  }

  if (!EMAIL_REGEX.test(String(email).trim())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address format',
    });
  }

  next();
};

export const validateRegister = (req, res, next) => {
  const {
    name,
    companyName,
    collegeName,
    fullName,
    email,
    phone,
    password,
    role = 'student',
    college,
    graduationYear,
    collegeId,
  } = req.body;

  const resolvedName = name || companyName || collegeName || fullName;

  if (!resolvedName) {
    return res.status(400).json({
      success: false,
      message: 'Name or company/institution name is required',
    });
  }

  if (!email || !EMAIL_REGEX.test(String(email).trim())) {
    return res.status(400).json({
      success: false,
      message: 'A valid email address is required',
    });
  }

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required',
    });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long',
    });
  }

  // Student specific validation
  if (role === 'student') {
    if (!college || !graduationYear || !collegeId) {
      return res.status(400).json({
        success: false,
        message: 'College, graduation year, and college ID are required for student accounts',
      });
    }
  }

  next();
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const containsUnsafeKey = (value) => {
  if (Array.isArray(value)) return value.some(containsUnsafeKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, nestedValue]) =>
    key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key) ||
    containsUnsafeKey(nestedValue)
  );
};

const PROFILE_STRING_FIELDS = [
  'name', 'headline', 'bio', 'about', 'location', 'phone', 'profileIcon', 'college', 'collegeName',
  'course', 'branch', 'department', 'experienceLevel', 'portfolioUrl', 'githubUrl',
  'linkedinUrl', 'github', 'linkedin', 'logo', 'companySize', 'teamSize', 'openToWorkMessage',
  'currentPassword', 'newPassword',
];

const PROFILE_ARRAY_FIELDS = [
  'skills', 'primarySkills', 'projects', 'certifications', 'achievements', 'metrics',
];

const PROFILE_OBJECT_FIELDS = [
  'companyProfile', 'collegeProfile', 'notificationPreferences', 'privacyPreferences',
];

const isAllowedAvatarValue = (value) => {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return false;

  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch {
    // Preset and legacy values may be root-relative or relative upload paths.
    return !value.startsWith('//') && !value.includes('\\') &&
      !/[\u0000-\u001f\u007f\s]/.test(value) &&
      !/^[a-z][a-z\d+.-]*:/i.test(value) &&
      value.split(/[?#]/, 1)[0].split('/').every((segment) => segment !== '..') &&
      (value.startsWith('/') || value.startsWith('uploads/'));
  }
};

export const validateProfileUpdate = (req, res, next) => {
  const data = req.body;
  const invalid = (field) => res.status(400).json({
    success: false,
    message: `Invalid profile update: ${field} has an unsupported value`,
  });

  if (!isPlainObject(data)) {
    return res.status(400).json({
      success: false,
      message: 'Profile update body must be a JSON object',
    });
  }

  for (const field of PROFILE_STRING_FIELDS) {
    if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
      return invalid(field);
    }
  }

  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
    return invalid('name');
  }
  if (data.phone !== undefined && (typeof data.phone !== 'string' || !data.phone.trim())) {
    return invalid('phone');
  }
  for (const [field, value] of [
    ['profileIcon', data.profileIcon],
    ['logo', data.logo],
    ['companyProfile.logo', data.companyProfile?.logo],
  ]) {
    if (value !== undefined && !isAllowedAvatarValue(value)) return invalid(field);
  }

  for (const field of PROFILE_ARRAY_FIELDS) {
    if (data[field] !== undefined && !Array.isArray(data[field])) return invalid(field);
  }

  for (const field of PROFILE_OBJECT_FIELDS) {
    if (data[field] !== undefined && !isPlainObject(data[field])) return invalid(field);
  }

  for (const field of ['dob']) {
    if (data[field] !== undefined && data[field] !== null &&
      (typeof data[field] !== 'string' || Number.isNaN(Date.parse(data[field])))) {
      return invalid(field);
    }
  }

  for (const field of ['graduationYear', 'gradYear', 'establishedYear', 'establishmentYear']) {
    const value = data[field];
    if (value !== undefined && value !== null && value !== '') {
      if (!['number', 'string'].includes(typeof value) || !Number.isInteger(Number(value))) {
        return invalid(field);
      }
    }
  }

  if (data.experienceLevel !== undefined &&
    !['Beginner', 'Intermediate', 'Experienced', ''].includes(data.experienceLevel)) {
    return invalid('experienceLevel');
  }

  if (data.twoFactorEnabled !== undefined && typeof data.twoFactorEnabled !== 'boolean') {
    return invalid('twoFactorEnabled');
  }

  if (data.passwords !== undefined && !isPlainObject(data.passwords)) return invalid('passwords');
  if (data.passwords?.current !== undefined && typeof data.passwords.current !== 'string') {
    return invalid('passwords.current');
  }
  if (data.passwords?.newPass !== undefined && typeof data.passwords.newPass !== 'string') {
    return invalid('passwords.newPass');
  }

  if (containsUnsafeKey(data)) return invalid('nested fields');

  req.body = sanitizeProfileUpdate(data);
  next();
};
