import mongoose from 'mongoose';
import Internship from '../models/Internship.js';
import InternshipAction from '../models/InternshipAction.js';

export const updateInternshipAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid internship ID',
      });
    }

    if (!['accepted', 'rejected', 'saved', 'unsaved'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action',
      });
    }

    const internship = await Internship.findOne({
      _id: id,
      status: 'active',
    });

    if (!internship) {
      return res.status(404).json({
        success: false,
        message: 'Active internship not found',
      });
    }

    const update = action === 'accepted' || action === 'rejected'
      ? { decision: action }
      : { saved: action === 'saved' };

    const result = await InternshipAction.findOneAndUpdate(
      { user: req.user.id, internship: id },
      {
        $set: update,
        $setOnInsert: { user: req.user.id, internship: id },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.json({
      success: true,
      message: 'Internship action updated',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyInternshipActions = async (req, res, next) => {
  try {
    const actions = await InternshipAction.find({
      user: req.user.id,
    })
      .populate('internship')
      .sort({ updatedAt: -1 });

    return res.json({ success: true, data: actions });
  } catch (error) {
    next(error);
  }
};
