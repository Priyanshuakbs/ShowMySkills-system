import { generateOtp } from '../utils/otp.js';
import { emailService } from './emailService.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export const userService = {
  authenticate: async (email, password) => {
    if (!email || !password) {
      const error = new Error('Email and password are required');
      error.statusCode = 400;
      throw error;
    }

    const user = await User.findOne({
      email: String(email).trim().toLowerCase(),
    });

    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    };
  },

  createUser: async (userData) => {
    const {
      name,
      email,
      phone,
      password,
      college,
      graduationYear,
      collegeId,
      collegeIdDocument,
    } = userData;

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 409;
      throw error;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();

    const otpExpiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    );

    const user = await User.create({
      name,
      email: normalizedEmail,
      phone,
      password: hashedPassword,
      college,
      graduationYear,
      collegeId,
      collegeIdDocument,
      emailVerificationOtp: otp,
      emailVerificationOtpExpires: otpExpiresAt,
    });

    await emailService.sendVerificationOtp(normalizedEmail, otp);

    const userResponse = user.toObject();

    delete userResponse.password;
    delete userResponse.emailVerificationOtp;
    delete userResponse.emailVerificationOtpExpires;

    return userResponse;
  },

  verifyEmailOtp: async (email, otp) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (!user.emailVerificationOtp) {
      const error = new Error(
        'No OTP found. Please request a new OTP.'
      );
      error.statusCode = 400;
      throw error;
    }

    if (user.emailVerificationOtp !== String(otp)) {
      const error = new Error('Invalid OTP');
      error.statusCode = 400;
      throw error;
    }

    if (
      !user.emailVerificationOtpExpires ||
      user.emailVerificationOtpExpires < new Date()
    ) {
      const error = new Error('OTP has expired');
      error.statusCode = 400;
      throw error;
    }

    user.emailVerified = true;
    user.emailVerificationOtp = null;
    user.emailVerificationOtpExpires = null;

    await user.save();

    const userResponse = user.toObject();

    delete userResponse.password;
    delete userResponse.emailVerificationOtp;
    delete userResponse.emailVerificationOtpExpires;

    return userResponse;
  },
};