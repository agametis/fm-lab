const cors = require('cors');
const environment = require('../config/environment');

/**
 * CORS Middleware Configuration
 */

// CORS: with `origin: '*'`, `credentials: true` violates the spec and the
// browser will block any preflight (any request with a non-simple header like
// Content-Type: application/json). We don't use cookies or Authorization
// headers from the frontend today, so credentials stays off. If auth gets
// added later, switch `origin` to an explicit allowlist before re-enabling.
const corsOptions = {
  origin: environment.cors.origin === '*' ? '*' : environment.cors.origin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 300, // 5 minutes — short enough to recover quickly from middleware changes during dev
};

const corsMiddleware = cors(corsOptions);

module.exports = corsMiddleware;
