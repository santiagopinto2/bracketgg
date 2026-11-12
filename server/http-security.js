// Security headers, a same-origin check for requests that change something, a small per-address rate
// limit, and the static file server for the built app.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Headers on every response
function securityHeaders(req, res, next) {
    res.set({
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-frame-options': 'DENY',
        'cross-origin-opener-policy': 'same-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
}

const sha256 = text => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const decodeEntities = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The page's Content Security Policy. index.html's own inline scripts (the iPhone zoom fix) and inline
// event handlers (the build's onload that switches the stylesheet on) are allowed by their hashes;
// no other script runs. Material and the build's inlined critical CSS need inline styles.
function contentSecurityPolicy(html) {
    const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => sha256(m[1]));
    const handlers = [...html.matchAll(/<[^>]+?\son[a-z]+=(?:"([^"]*)"|'([^']*)')/gi)].map(m => sha256(decodeEntities(m[1] ?? m[2])));
    const scriptSrc = ["'self'", ...new Set(scripts), ...(handlers.length ? ["'unsafe-hashes'", ...new Set(handlers)] : [])];
    return [
        "default-src 'self'",
        `script-src ${scriptSrc.join(' ')}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');
}

// Refuses a request that changes something when it comes from another site: its Origin must be this
// host, and Sec-Fetch-Site (sent by browsers) must not say cross-site. Together with the SameSite=Lax
// cookie this stops cross-site request forgery.
function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch { }
        if (!host || host !== req.get('host')) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    next();
}

// At most `max` requests per `windowMs` from one address (req.ip; the app trusts its local proxy's
// X-Forwarded-For). Answers 429 with Retry-After past that.
function rateLimit({ max, windowMs = 60_000, now = () => Date.now(), maxAddresses = 20_000 }) {
    const hits = new Map(); // ip -> { count, resetAt }
    const sweep = setInterval(() => {
        const t = now();
        for (const [ip, entry] of hits) if (entry.resetAt <= t) hits.delete(ip);
    }, windowMs);
    sweep.unref?.();
    return (req, res, next) => {
        const t = now();
        const ip = req.ip || 'unknown';
        let entry = hits.get(ip);
        if (!entry || entry.resetAt <= t) {
            if (!entry && hits.size >= maxAddresses) hits.clear();
            entry = { count: 0, resetAt: t + windowMs };
            hits.set(ip, entry);
        }
        if (++entry.count > max) {
            res.set('retry-after', String(Math.ceil((entry.resetAt - t) / 1000)));
            return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
        }
        next();
    };
}

// Serves the built app: hashed files (main-ABCD1234.js) are cached for a year, index.html is checked
// every time, and a missing file with an extension is a 404 instead of the app's page.
function staticApp(express, staticDir) {
    const indexFile = path.join(staticDir, 'index.html');
    let index = { mtimeMs: -1, html: '', csp: '' };
    const loadIndex = () => {
        const { mtimeMs } = fs.statSync(indexFile);
        if (mtimeMs !== index.mtimeMs) {
            const html = fs.readFileSync(indexFile, 'utf8');
            index = { mtimeMs, html, csp: contentSecurityPolicy(html) };
        }
        return index;
    };

    const files = express.static(staticDir, {
        index: false,
        setHeaders(res, file) {
            const name = path.basename(file);
            if (/-[A-Z0-9]{8,}\.(js|css)$/.test(name) || file.includes(`${path.sep}media${path.sep}`)) res.set('cache-control', 'public, max-age=31536000, immutable');
            else res.set('cache-control', 'public, max-age=3600');
        },
    });

    const sendIndex = (req, res) => {
        let page;
        try { page = loadIndex(); } catch (error) {
            console.error('index.html:', error.message);
            return res.status(500).type('text').send('The app is not built.');
        }
        res.set({ 'cache-control': 'no-cache', 'content-security-policy': page.csp }).type('html').send(page.html);
    };

    return [
        (req, res, next) => (req.path === '/index.html' ? sendIndex(req, res) : next()),
        files,
        (req, res, next) => {
            if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) return next();
            if (path.posix.extname(req.path)) return res.status(404).type('text').send('Not found');
            sendIndex(req, res);
        },
    ];
}

module.exports = { securityHeaders, contentSecurityPolicy, sameOrigin, rateLimit, staticApp };
