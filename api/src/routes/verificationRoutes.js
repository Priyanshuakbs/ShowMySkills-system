import express from 'express';
import {
  uploadAndVerifyCollegeId,
  getVerificationStatus
} from '../controllers/verificationController.js';
import { uploadCollegeId } from '../middleware/uploadMiddleware.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * /api/verification/status:
 *   get:
 *     summary: Get student verification status
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification status retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get(
  '/status',
  authMiddleware,
  getVerificationStatus
);

/**
 * @swagger
 * /api/verification/college-id:
 *   post:
 *     summary: Upload and verify student college ID
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - front
 *               - back
 *             properties:
 *               front:
 *                 type: string
 *                 format: binary
 *                 description: Front side of the college ID
 *               back:
 *                 type: string
 *                 format: binary
 *                 description: Back side of the college ID
 *     responses:
 *       200:
 *         description: College ID verified successfully
 *       400:
 *         description: Invalid request or missing files
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: College ID could not be verified
 */
router.post(
  '/college-id',
  authMiddleware,
  uploadCollegeId.fields([
    {
      name: 'front',
      maxCount: 1
    },
    {
      name: 'back',
      maxCount: 1
    }
  ]),
  uploadAndVerifyCollegeId
);

export default router;