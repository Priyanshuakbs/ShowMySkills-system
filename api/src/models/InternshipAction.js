import mongoose from 'mongoose';

const internshipActionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    internship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Internship',
      required: true,
    },
    decision: {
      type: String,
      enum: ['accepted', 'rejected', null],
      default: null,
    },
    saved: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

internshipActionSchema.index(
  { user: 1, internship: 1 },
  { unique: true }
);

export default mongoose.models.InternshipAction ||
  mongoose.model('InternshipAction', internshipActionSchema);
