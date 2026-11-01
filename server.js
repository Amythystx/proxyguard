const express  = require('express');
const mongoose = require('mongoose');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());

// Startup security checks: Validate JWT_SECRET and NODE_ENV
const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET) {
  if (isProduction) {
    console.error('CRITICAL: JWT_SECRET environment variable is missing in production.');
    process.exit(1);
  } else {
    console.warn('⚠️ Warning: JWT_SECRET is not set in development. Authentication operations require JWT_SECRET.');
  }
} else if (isProduction && process.env.JWT_SECRET.length < 16) {
  console.error('CRITICAL: JWT_SECRET is too short for production (must be at least 16 characters).');
  process.exit(1);
}

// Static frontend paths
const publicDir = path.join(__dirname, 'public');
const indexHtmlPath = path.join(publicDir, 'index.html');

// Serve static frontend files from /public and html5-qrcode library
app.use(express.static(publicDir));
app.use('/lib', express.static(path.join(__dirname, 'node_modules/html5-qrcode')));

// ── Database Connection & Lifecycle (Serverless-friendly) ──────────────────
let cachedConnectionPromise = null;

async function connectToDatabase() {
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (mongoose.connection.readyState === 2 && cachedConnectionPromise) {
    return cachedConnectionPromise;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    if (isProduction) {
      console.error('CRITICAL: MONGO_URI environment variable is missing in production.');
    } else {
      console.warn('⚠️ Warning: MONGO_URI environment variable is not set in environment variables.');
    }
    return null;
  }

  cachedConnectionPromise = mongoose.connect(mongoUri, {
    bufferCommands: false,
  }).catch((err) => {
    cachedConnectionPromise = null;
    throw err;
  });

  return cachedConnectionPromise;
}

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB connection lost. API requests will return 503 until reconnected.');
  cachedConnectionPromise = null;
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
});

// Database availability gate for API routes
// Rejects requests immediately if MongoDB is not connected, avoiding hung requests / buffer timeouts
app.use('/api', async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectToDatabase();
    } catch (err) {
      // Error will be logged by connectToDatabase or connection event listeners
    }
  }

  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Database service is currently unavailable. Please try again shortly.'
    });
  }
  next();
});

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/subjects',      require('./routes/subjects'));
app.use('/api/sessions',      require('./routes/sessions'));
app.use('/api/attendance',    require('./routes/attendance'));
app.use('/api/admin',         require('./routes/admin'));         // admin-only routes
app.use('/api/notifications', require('./routes/notifications')); // in-app notifications
app.use('/api/analytics',     require('./routes/analytics'));     // advanced analytics

// Handle unmatched API routes with a clean JSON 404 (matches /api, /api/, and /api/*)
app.all('/api', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Catch-all: unknown GET routes serve index.html for SPA routing (exclude /api routes)
app.get('/{*path}', (req, res) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API endpoint not found' });
  }
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }
  res.status(404).send('Not Found');
});

// ── Centralized Express JSON Error Handler ──────────────────────────────────
// Logs full error server-side while ensuring client always receives clean JSON without stack traces
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err.message || err);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = (typeof err.status === 'number' && err.status >= 400 && err.status < 600)
    ? err.status
    : 500;

  res.status(statusCode).json({
    message: statusCode === 500 ? 'Internal server error' : (err.message || 'Error occurred')
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  connectToDatabase().catch((err) => {
    console.error('Initial MongoDB connection failed:', err.message);
    console.error('API endpoints requiring database access will return 503 until connection is established.');
  });
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;