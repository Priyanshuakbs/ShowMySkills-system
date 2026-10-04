import { User } from '../models/User.js';
import { extractTextFromImage } from '../utils/ocr.js';

const normalizeText = (text = '') => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeName = (name = '') => {
  return normalizeText(name)
    .replace(/\b(mr|mrs|ms|miss)\b/g, '')
    .trim();
};

const containsName = (ocrText, name) => {
  const text = normalizeText(ocrText);
  const normalizedName = normalizeName(name);

  if (!normalizedName) return false;

  const nameParts = normalizedName
    .split(' ')
    .filter(Boolean);

  return nameParts.every((part) => text.includes(part));
};

const containsCollege = (ocrText, college) => {
  const text = normalizeText(ocrText);
  const normalizedCollege = normalizeText(college);

  if (!normalizedCollege) return false;

  const collegeWords = normalizedCollege
    .split(' ')
    .filter((word) => word.length > 2);

  return collegeWords.every((word) => text.includes(word));
};

export const verifyCollegeId = async (
  userId,
  frontFile,
  backFile
) => {
  if (!frontFile || !backFile) {
    throw new Error(
      'Both front and back images of college ID are required.'
    );
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found.');
  }

  if (!user.name) {
    throw new Error(
      'Student profile name is required before verification.'
    );
  }

  if (!user.college) {
    throw new Error(
      'Student college information is required before verification.'
    );
  }

  await User.findByIdAndUpdate(userId, {
    'verification.status': 'processing',
    'verification.collegeId.rejectionReason': null,
    profileCompleted: false
  });

  try {
    const [frontResult, backResult] = await Promise.all([
      extractTextFromImage(frontFile.buffer),
      extractTextFromImage(backFile.buffer)
    ]);

    if (!frontResult.success || !backResult.success) {
      await User.findByIdAndUpdate(userId, {
        'verification.status': 'rejected',
        'verification.collegeId.rejectionReason':
          'Unable to read the college ID. Please upload clear images.',
        profileCompleted: false
      });

      return {
        verified: false,
        reason:
          'Unable to read the college ID. Please upload clear images.'
      };
    }

    const frontText = frontResult.text;
    const backText = backResult.text;

    const minimumFrontConfidence = 50;

    if (frontResult.confidence < minimumFrontConfidence) {
      await User.findByIdAndUpdate(userId, {
        'verification.status': 'rejected',
        'verification.collegeId.frontConfidence':
          frontResult.confidence,
        'verification.collegeId.backConfidence':
          backResult.confidence,
        'verification.collegeId.nameMatched': false,
        'verification.collegeId.collegeMatched': false,
        'verification.collegeId.rejectionReason':
          'College ID image is unclear. Please upload a clearer front image.',
        profileCompleted: false
      });

      return {
        verified: false,
        reason:
          'College ID image is unclear. Please upload a clearer front image.'
      };
    }

    const nameMatched =
      containsName(frontText, user.name) ||
      containsName(backText, user.name);

    if (!nameMatched) {
      await User.findByIdAndUpdate(userId, {
        'verification.status': 'rejected',
        'verification.collegeId.frontConfidence':
          frontResult.confidence,
        'verification.collegeId.backConfidence':
          backResult.confidence,
        'verification.collegeId.nameMatched': false,
        'verification.collegeId.collegeMatched': false,
        'verification.collegeId.rejectionReason':
          'Student name could not be verified from the college ID.',
        profileCompleted: false
      });

      return {
        verified: false,
        reason:
          'Student name could not be verified from the college ID.'
      };
    }

    const collegeMatched =
      containsCollege(frontText, user.college) ||
      containsCollege(backText, user.college);

    if (!collegeMatched) {
      await User.findByIdAndUpdate(userId, {
        'verification.status': 'rejected',
        'verification.collegeId.frontConfidence':
          frontResult.confidence,
        'verification.collegeId.backConfidence':
          backResult.confidence,
        'verification.collegeId.nameMatched': true,
        'verification.collegeId.collegeMatched': false,
        'verification.collegeId.rejectionReason':
          'College or university could not be verified from the college ID.',
        profileCompleted: false
      });

      return {
        verified: false,
        reason:
          'College or university could not be verified from the college ID.'
      };
    }

    await User.findByIdAndUpdate(userId, {
      'verification.status': 'verified',
      'verification.collegeId.frontConfidence':
        frontResult.confidence,
      'verification.collegeId.backConfidence':
        backResult.confidence,
      'verification.collegeId.nameMatched': true,
      'verification.collegeId.collegeMatched': true,
      'verification.collegeId.uploadedAt': new Date(),
      'verification.collegeId.verifiedAt': new Date(),
      'verification.collegeId.rejectionReason': null,
      profileCompleted: true
    });

    return {
      verified: true,
      frontConfidence: frontResult.confidence,
      backConfidence: backResult.backConfidence,
      nameMatched: true,
      collegeMatched: true
    };
  } catch (error) {
    await User.findByIdAndUpdate(userId, {
      'verification.status': 'rejected',
      'verification.collegeId.rejectionReason':
        'Verification failed. Please upload the college ID again.',
      profileCompleted: false
    });

    throw error;
  }
};