
import Internship from '../models/Internship.js';

export const getInternships = async (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));

  const filter = { status: 'active' };

  if (query.mode) {
    const mode = String(query.mode).toLowerCase();

    if (!['remote', 'onsite', 'hybrid'].includes(mode)) {
      const error = new Error('Invalid internship mode');
      error.statusCode = 400;
      throw error;
    }

    filter.mode = mode;
  }

  if (query.location) {
    filter.location = {
      $regex: String(query.location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      $options: 'i',
    };
  }

  if (query.verified === 'true') {
    filter.isVerified = true;
  }

  if (query.skill) {
    filter.skills = {
      $in: [new RegExp(
        String(query.skill).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      )],
    };
  }

  if (query.search) {
    const term = String(query.search).trim().slice(0, 100);

    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      filter.$or = [
        { role: { $regex: escaped, $options: 'i' } },
        { company: { $regex: escaped, $options: 'i' } },
        { skills: { $regex: escaped, $options: 'i' } },
      ];
    }
  }

  const [items, total] = await Promise.all([
    Internship.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Internship.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
    },
  };
};

export const getInternshipById = async (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) {
    const error = new Error('Invalid internship ID');
    error.statusCode = 400;
    throw error;
  }

  const internship = await Internship.findOne({
    _id: id,
    status: 'active',
  }).lean();

  if (!internship) {
    const error = new Error('Internship not found');
    error.statusCode = 404;
    throw error;
  }

  return internship;
};
