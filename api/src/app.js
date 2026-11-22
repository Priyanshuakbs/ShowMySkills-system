import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import path from 'node:path';

import { swaggerSpec } from './config/swagger.js';
import {
  helmetSecurity,
  corsOptions,
  globalRateLimiter,
  noSqlSanitizer,
  xssSanitizer,
  hppProtection,
} from './middleware/security.js';

import authRoutes from './routes/authRoutes.js';
import User from './models/User.js';
import Application from './models/Application.js';
import userRoutes from './routes/userRoutes.js';
import internshipRoutes from './routes/internshipRoutes.js';
import internshipActionRoutes from './routes/internshipActionRoutes.js';
import adminApplicationRoutes from './routes/adminApplicationRoutes.js';
import applicationRoutes from './routes/applicationRoutes.js';
import launchpadRoutes from './routes/launchpadRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import verificationRoutes from './routes/verificationRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import skillRoutes from './routes/skillRoutes.js';
import bookmarkRoutes from './routes/bookmarkRoutes.js';
import monitoringRoutes from './routes/monitoringRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { requestLogger } from './middleware/logger.js';
import { authMiddleware } from './middleware/authMiddleware.js';
import monitoringService from './services/monitoringService.js';

const app = express();

// Trust reverse proxy (e.g., Nginx, AWS ALB/EC2) for accurate client IP in rate limiting
app.set('trust proxy', 1);

// ──── Security Layer 1: HTTP Headers & CORS ────
app.use(helmetSecurity);
app.use(cors(corsOptions));

// ──── Real-Time HTTP Logging & Telemetry ────
app.use(requestLogger);

// ──── Security Layer 2: Payload Size Protection ────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ──── Security Layer 3: NoSQL Injection, XSS, & HPP Sanitization ────
app.use(noSqlSanitizer);
app.use(xssSanitizer);
app.use(hppProtection);

// Resume URLs retain their existing paths and download with a stable filename.
const canonicalResumeReference = (filename) => {
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api`;
  const rootUrl = baseUrl.replace(/\/api\/?$/, '');
  return `${rootUrl}/uploads/resumes/${filename}`;
};

const authorizeResumeDownload = async (req, res, next) => {
  let filename;
  try {
    const decodedPath = decodeURIComponent(req.path);
    const match = decodedPath.match(/^\/([A-Za-z0-9_.-]+-[0-9]+-[0-9]+\.[A-Za-z0-9]+)$/);
    if (!match || req.path.includes('%')) return res.sendStatus(404);
    filename = match[1];
  } catch {
    return res.sendStatus(404);
  }

  try {
    const resumeReference = canonicalResumeReference(filename);
    const isOwner = await User.exists({ _id: req.user.id, resumeUrl: resumeReference });
    if (isOwner) return next();

    if (req.user.role !== 'company') return res.sendStatus(404);

    const applicantIds = await Application.distinct('student', {
      company: req.user.id,
      'candidateSnapshot.resumeUrl': resumeReference,
    });
    if (!applicantIds.length) return res.sendStatus(404);

    // Snapshots are historical display data and are not proof of file ownership.
    // Confirm the referenced resume is still the canonical resume of the
    // student attached to this company application before granting access.
    const applicantOwnsResume = await User.exists({
      _id: { $in: applicantIds },
      resumeUrl: resumeReference,
    });
    if (!applicantOwnsResume) return res.sendStatus(404);
    next();
  } catch (error) {
    next(error);
  }
};

app.use(
  '/uploads/resumes',
  authMiddleware,
  authorizeResumeDownload,
  express.static(path.join(process.cwd(), 'uploads', 'resumes'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath).replace(/["\\\r\n]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
    },
  })
);

// Static file serving for other uploads with restricted caching & noSniff
app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d',
  })
);

// API Router mounted under /api
const apiRouter = express.Router();

// ──── Security Layer 4: Global Rate Limiting on API Router ────
apiRouter.use(globalRateLimiter);

const swaggerUiOptions = {
  customSiteTitle: 'ShowMySkills REST API Documentation',
  customCss: `
    .swagger-ui .topbar { background-color: #0d1117; border-bottom: 1px solid #30363d; }
    .swagger-ui .topbar .topbar-wrapper .link span { color: #58a6ff; font-weight: 700; font-size: 1.1rem; }
    .swagger-ui .info h2 { color: #238636; }
    .swagger-ui .info .title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-weight: 700; }
    .swagger-ui .btn.authorize { color: #2ea043; border-color: #2ea043; }
    .swagger-ui .btn.authorize svg { fill: #2ea043; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    docExpansion: 'none',
    tryItOutEnabled: true,
  },
};

// Swagger Documentation: /api/docs & Raw JSON endpoints: /api/docs.json, /api/docs/swagger.json
apiRouter.get('/docs/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
apiRouter.get('/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
apiRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Authentication Routes: /api/auth/*
apiRouter.use('/auth', authRoutes);

// Users & People Directory: /api/users/*
apiRouter.use('/users', userRoutes);

// Centralized File Uploads: /api/upload/*
apiRouter.use('/upload', uploadRoutes);

// Skill Benchmarks & Verification Tests: /api/skills/*
apiRouter.use('/skills', skillRoutes);

// Bookmarks & Saved Talent/Internships: /api/bookmarks/*
apiRouter.use('/bookmarks', bookmarkRoutes);

// Internship Discovery Feed: /api/internships/*
apiRouter.use('/internships', internshipRoutes);

// Internship Actions: /api/internship-actions/*
apiRouter.use('/internship-actions', internshipActionRoutes);

// Candidate Applications & ATS: /api/applications/*
apiRouter.use('/applications', applicationRoutes);

// Launchpad Top Opportunities: /api/launchpad/*
apiRouter.use('/launchpad', launchpadRoutes);

// Peer & Recruiter Direct Chats: /api/chats/*
apiRouter.use('/chats', chatRoutes);

// Admin Governance & Moderation: /api/admin/*
apiRouter.use('/admin', adminRoutes);

// Admin Application Legacy Route (preserving compatibility)
apiRouter.use('/admin-applications', adminApplicationRoutes);
apiRouter.use('/admin/applications', adminApplicationRoutes);

// Verification Requests: /api/verifications/*
apiRouter.use('/verifications', verificationRoutes);

// System & User Notifications: /api/notifications/*
apiRouter.use('/notifications', notificationRoutes);

// Helpdesk & Support FAQs: /api/support/*
apiRouter.use('/support', supportRoutes);

// Real-Time System Monitoring & Telemetry: /api/monitoring/*
apiRouter.use('/monitoring', monitoringRoutes);

// System Health & Diagnostics API: /api/health
apiRouter.use('/health', healthRoutes);

// Catch-all handler for unknown API endpoints
apiRouter.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'NotFound',
    message: `API endpoint '${req.originalUrl}' does not exist.`,
  });
});

// Root-level health check for reverse proxy / container orchestrators (e.g., http://localhost:5000/health)
app.use('/health', healthRoutes);

// Mount all API routes under /api
app.use('/api', apiRouter);

// ──── Security Layer 5: Safe Production Error Handler ────
app.use((err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const statusCode = err.statusCode || 500;

  // Record error in monitoring engine
  monitoringService.recordError({
    id: req.id,
    method: req.method,
    path: req.originalUrl || req.url,
    status: statusCode,
    message: err.message,
    stack: err.stack,
  });

  if (!isProduction) {
    console.error(`[Error] ${req.method} ${req.url}:`, err.stack || err.message);
  }

  // Detect technical database/socket driver errors to prevent leaking internal infrastructure details
  const isTechnicalDbError =
    err.isDatabaseError ||
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoTimeoutError' ||
    (typeof err.message === 'string' &&
      (err.message.includes('connectTimeoutMS') ||
        err.message.includes('secureConnect') ||
        err.message.includes('Topology') ||
        err.message.includes('ECONNREFUSED')));

  let message = err.message || 'Internal Server Error';
  if (isTechnicalDbError) {
    message = 'Database service is temporarily unavailable. Please try again in a moment.';
  } else if (statusCode >= 500) {
    message = 'An unexpected internal server error occurred.';
  }

  res.status(isTechnicalDbError && statusCode === 500 ? 503 : statusCode).json({
    success: false,
    error: isTechnicalDbError ? 'ServiceUnavailable' : (err.name || 'Error'),
    message,
    ...(err.code ? { code: err.code } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

export default app;
