import mongoose from 'mongoose';

const internshipSchema = new mongoose.Schema(
  {
    company: {
      type: String,
      required: true,
      trim: true,
    },
    companyLogo: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      default: '',
      trim: true,
    },
    mode: {
      type: String,
      enum: ['remote', 'onsite', 'hybrid'],
      default: 'remote',
    },
    stipendMin: {
      type: Number,
      default: 0,
      min: 0,
    },
    stipendMax: {
      type: Number,
      default: 0,
      min: 0,
    },
    duration: {
      type: String,
      default: '',
    },
    skills: {
      type: [String],
      default: [],
    },
    responsibilities: {
      type: [String],
      default: [],
    },
    employmentType: {
      type: String,
      default: 'Internship',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'closed', 'draft'],
      default: 'draft',
    },
    applicationUrl: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

internshipSchema.index({
  company: 'text',
  role: 'text',
  skills: 'text',
});

export default mongoose.models.Internship ||
  mongoose.model('Internship', internshipSchema);
