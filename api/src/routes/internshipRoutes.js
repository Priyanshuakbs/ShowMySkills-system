
import express from 'express';
import {
  listInternships,
  internshipDetails,
} from '../controllers/internshipController.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Internships
 *   description: Internship discovery feed
 */

/**
 * @swagger
 * /internships:
 *   get:
 *     summary: Get internships with search and filters
 *     tags: [Internships]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [remote, onsite, hybrid]
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *       - in: query
 *         name: verified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Internship feed retrieved
 */
router.get('/', listInternships);

/**
 * @swagger
 * /internships/{id}:
 *   get:
 *     summary: Get internship details
 *     tags: [Internships]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Internship details retrieved
 *       404:
 *         description: Internship not found
 */
router.get('/:id', internshipDetails);

export default router;
