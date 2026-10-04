import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'processing', 'verified', 'rejected'],
      default: 'pending'
    },

  collegeId: {
  frontImageUrl: {
    type: String,
    default: null
  },

  backImageUrl: {
    type: String,
    default: null
  },

  frontConfidence: {
    type: Number,
    default: null
  },

  backConfidence: {
    type: Number,
    default: null
  },

  nameMatched: {
    type: Boolean,
    default: false
  },

  collegeMatched: {
    type: Boolean,
    default: false
  },

  uploadedAt: {
    type: Date,
    default: null
  },

  verifiedAt: {
    type: Date,
    default: null
  },

  rejectionReason: {
    type: String,
    default: null
  }
},

    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    _id: false
  }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },

    email: {
      type: String,
      required: true,
      unique: true
    },

    password: {
      type: String,
      required: true
    },

    role: {
      type: String,
      default: 'user'
    },

    // Student profile information
    profileCompleted: {
      type: Boolean,
      default: false
    },

    college: {
      type: String,
      default: null
    },

    graduationYear: {
      type: Number,
      default: null
    },

    // Student verification information
    verification: {
      type: verificationSchema,
      default: () => ({})
    }
  },
  {
    timestamps: true
  }
);

export const User = mongoose.model('User', userSchema);