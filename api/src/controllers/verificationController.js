import { verifyCollegeId } from '../services/verificationService.js';

export const uploadAndVerifyCollegeId = async (req, res) => {
  try {
    const frontFile = req.files?.front?.[0];
    const backFile = req.files?.back?.[0];

    if (!frontFile || !backFile) {
      return res.status(400).json({
        success: false,
        message: 'Both front and back college ID images are required.'
      });
    }

    const result = await verifyCollegeId(
      req.user.id,
      frontFile,
      backFile
    );

    if (!result.verified) {
      return res.status(422).json({
        success: false,
        verified: false,
        message: result.reason
      });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      message: 'College ID verified successfully.',
      data: {
        frontConfidence: result.frontConfidence,
        backConfidence: result.backConfidence
      }
    });
  } catch (error) {
    console.error('College ID verification error:', error);

    return res.status(500).json({
      success: false,
      message: 'College ID verification failed.'
    });
  }
};

export const getVerificationStatus = async (req, res) => {
  try {
    const { User } = await import('../models/User.js');

    const user = await User.findById(req.user.id).select(
      'profileCompleted verification.status verification.collegeId.frontConfidence verification.collegeId.backConfidence verification.collegeId.nameMatched verification.collegeId.collegeMatched verification.collegeId.uploadedAt verification.collegeId.verifiedAt verification.collegeId.rejectionReason college graduationYear'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profileCompleted: user.profileCompleted,
        college: user.college,
        graduationYear: user.graduationYear,
        verification: {
          status: user.verification?.status || 'pending',
          frontConfidence:
            user.verification?.collegeId?.frontConfidence ?? null,
          backConfidence:
            user.verification?.collegeId?.backConfidence ?? null,
          nameMatched:
            user.verification?.collegeId?.nameMatched ?? false,
          collegeMatched:
            user.verification?.collegeId?.collegeMatched ?? false,
          uploadedAt:
            user.verification?.collegeId?.uploadedAt ?? null,
          verifiedAt:
            user.verification?.collegeId?.verifiedAt ?? null,
          rejectionReason:
            user.verification?.collegeId?.rejectionReason ?? null
        }
      }
    });
  } catch (error) {
    console.error('Get verification status error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to fetch verification status.'
    });
  }
};