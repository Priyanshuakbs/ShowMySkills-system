import {
  getInternships,
  getInternshipById,
} from '../services/internshipService.js';

export const listInternships = async (req, res, next) => {
  try {
    const result = await getInternships(req.query);

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const internshipDetails = async (req, res, next) => {
  try {
    const internship = await getInternshipById(req.params.id);

    return res.status(200).json({
      success: true,
      data: internship,
    });
  } catch (error) {
    next(error);
  }
};
