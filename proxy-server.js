// BracketGG's server: start.gg's GraphQL API through a shared cache, the start.gg login, and the
// built app.
//   node proxy-server.js                                  (API only, for ng serve's proxy)
//   STATIC_DIR=dist/bracketgg/browser node proxy-server.js (also serves the app)
//
// Environment (a .env file works too):
//   STARTGG_CLIENT_ID, STARTGG_CLIENT_SECRET, STARTGG_REDIRECT_URI   the start.gg OAuth app, for logging in
//   STARTGG_SITE_TOKEN      the site's own start.gg token, used for visitors who aren't logged in
//   SESSIONS_FILE           where logins are kept (a JSON file on a writable volume), so they survive a restart
//   COOKIE_SECURE=false     only for testing over plain http on a host other than localhost
//   SITE_TOKEN_PER_MINUTE (70), SITE_TOKEN_MAX_WAIT_MS (15000)   the site token's rate gate
//   PORT (3000), STATIC_DIR, STARTGG_GQL_URL, STARTGG_TOKEN_URL, STARTGG_REFRESH_URL (tests point these at a fake start.gg)
// Needs Node 22.18 or later (server/gql-allowlist.js reads a TypeScript file).

require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const { createGqlCache } = require('./server/gql-cache');
const { loadAllowlist } = require('./server/gql-allowlist');
const { createSessionStore } = require('./server/sessions');
const { createAuth } = require('./server/auth');
const { createSiteGate } = require('./server/site-gate');
const { securityHeaders, sameOrigin, rateLimit, staticApp } = require('./server/http-security');

const PORT = process.env.PORT || 3000;

async function main() {
  const allowed = await loadAllowlist();
  const sessions = createSessionStore({ file: process.env.SESSIONS_FILE });
  const auth = createAuth({ sessions });
  const siteGate = createSiteGate({
    perWindow: Number(process.env.SITE_TOKEN_PER_MINUTE) || 70,
    maxWaitMs: Number(process.env.SITE_TOKEN_MAX_WAIT_MS ?? 15_000),
  });
  if (!process.env.STARTGG_SITE_TOKEN) console.warn('STARTGG_SITE_TOKEN is not set: visitors must log in to see anything');

  const app = express();
  app.disable('x-powered-by');
  // The edge proxy (Caddy) on this machine forwards the visitor's address in X-Forwarded-For
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(securityHeaders);
  app.use('/api', express.json({ limit: '64kb' }));

  // start.gg's GraphQL API, through a cache shared by every viewer (server/gql-cache.js)
  const gqlCache = createGqlCache({ allowed, tokenFor: auth.tokenFor, siteGate });
  app.post('/api/gql', sameOrigin, gqlCache.handle);
  app.get('/api/gql/stats', (req, res) => res.json({ ...gqlCache.stats, ...gqlCache.size(), gate: siteGate.stats(), sessions: sessions.size() }));

  // Logging in (server/auth.js)
  app.use('/api/auth', rateLimit({ max: 60 }));
  app.get('/api/auth/session', auth.session);
  app.post('/api/auth/token', sameOrigin, rateLimit({ max: 10 }), auth.token);
  app.post('/api/auth/logout', sameOrigin, auth.logout);
  app.post('/api/auth/theme', sameOrigin, auth.theme);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (process.env.STATIC_DIR) app.use(staticApp(express, path.resolve(process.env.STATIC_DIR)));

  // Malformed JSON and other request errors, without a stack trace
  app.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : 'Bad request.' });
  });

  const server = app.listen(PORT, () => console.log(`BracketGG server running on http://localhost:${PORT}`));
  const stop = () => {
    sessions.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
