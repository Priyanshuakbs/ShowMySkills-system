import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  updateInternshipAction,
  getMyInternshipActions,
} from '../controllers/internshipActionController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/my-actions', getMyInternshipActions);
router.post('/:id/action', updateInternshipAction);

export default router;
