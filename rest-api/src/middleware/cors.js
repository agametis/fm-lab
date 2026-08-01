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
  // Every custom request header the clients send MUST be listed here. An explicit
  // `allowedHeaders` replaces the reflection of `Access-Control-Request-Headers`, so a
  // missing entry makes the browser reject the preflight and drop the request BEFORE it
  // is sent — cross-origin only, and invisible in the server log (the preflight is
  // answered by this middleware, ahead of the request logger). Keep in sync with the
  // headers set in apps/web (X-Solution: per-request solution context; X-Debug-Session:
  // correlated frontend/backend logging). A test enforces that pairing — see
  // tests/unit/cors-header-contract.test.js.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Solution', 'X-Debug-Session'],
  credentials: false,
  maxAge: 300, // 5 minutes — short enough to recover quickly from middleware changes during dev
};

const corsMiddleware = cors(corsOptions);

module.exports = corsMiddleware;
// The resolved options, so the header contract can be asserted without parsing
// this file. Express ignores extra properties on a middleware function.
module.exports.corsOptions = corsOptions;
