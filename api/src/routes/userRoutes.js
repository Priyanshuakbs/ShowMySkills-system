import { Router } from 'express';
import { userController } from '../controllers/userController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateProfileUpdate } from '../validators/authValidator.js';

const router = Router();

/**
 * @openapi
 * /api/users:
 *   get:
 *     summary: Discover and search people / campus student directory
 *     description: Search and filter platform talent by keyword, college/university, platform role tag (Maintainer, Ambassador, Contributor), and specific skill.
 *     tags:
 *       - Users & Directory
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by candidate name, headline, bio, or college
 *       - in: query
 *         name: roleTag
 *         schema:
 *           type: string
 *           enum: [Admin, Maintainer, Promoter, Contributor, Ambassador, Regular]
 *         description: Filter students by verified community role tag
 *       - in: query
 *         name: college
 *         schema:
 *           type: string
 *         description: Filter by institution name
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *         description: Filter candidates by specific technical skill
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Records per page
 *     responses:
 *       200:
 *         description: List of candidates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/', userController.getUsers);

// Private college roster: email and verification status are not exposed by
// the unauthenticated public directory route above.
router.get('/college/students', authMiddleware, userController.getCollegeStudents);

/**
 * @openapi
 * /api/users/profile:
 *   put:
 *     summary: Update currently authenticated user profile
 *     description: Update candidate headline, bio, date of birth, skills, portfolio projects, certifications, or social links.
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users & Directory
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: 'Alex Morgan'
 *               headline:
 *                 type: string
 *                 example: 'Full Stack Engineer & Open Source Contributor'
 *               bio:
 *                 type: string
 *                 example: 'Passionate computer science student specializing in cloud architectures.'
 *               dob:
 *                 type: string
 *                 format: date
 *                 example: '2003-05-14'
 *               skills:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: 'React'
 *                     level:
 *                       type: string
 *                       enum: [beginner, intermediate, advanced, expert]
 *                       example: 'advanced'
 *               projects:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                       example: 'CampusHub'
 *                     description:
 *                       type: string
 *                       example: 'Real-time collaborative campus messaging platform'
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ['React', 'Node.js', 'WebSockets']
 *                     repoUrl:
 *                       type: string
 *                       example: 'https://github.com/example/campushub'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: 'Profile updated successfully'
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - Bearer token required
 */
router.put('/profile', authMiddleware, validateProfileUpdate, userController.updateProfile);

/**
 * @openapi
 * /api/users/settings:
 *   put:
 *     summary: Update notification, privacy, or security settings
 *     description: Configure user communication channels, privacy visibility, or notification preferences.
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users & Directory
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailNotifications:
 *                 type: boolean
 *                 example: true
 *               profileVisibility:
 *                 type: string
 *                 enum: [public, campus_only, private]
 *                 example: 'public'
 *     responses:
 *       200:
 *         description: Settings saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: 'Settings saved successfully'
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - Bearer token required
 */
router.put('/settings', authMiddleware, userController.updateSettings);

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     summary: Get user profile details by ID
 *     description: Retrieve public candidate profile information, skills, verified projects, and credentials.
 *     tags:
 *       - Users & Directory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of target user
 *         example: '67bb8e7d206f4a38b9c1d001'
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', userController.getUserById);

export default router;
