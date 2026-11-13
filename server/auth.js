// Logging in with start.gg, on the server.
//
// The browser sends start.gg's login code to POST /api/auth/token. The server trades it for tokens,
// keeps them in the session store (server/sessions.js) and gives the browser an HttpOnly, SameSite=Lax
// session cookie. Each /api/gql request from a logged-in browser then goes to start.gg with that
// visitor's token (tokenFor). An access token about to expire is refreshed first, and one refresh is
// shared by every request and tab of the same session. A session ends only when start.gg refuses its
// refresh token; a network error or a start.gg outage keeps it for the next try.
//
//   GET  /api/auth/session   { loggedIn, theme? }   (refreshes first if needed; theme if they chose one)
//   POST /api/auth/token     { code }  ->  { loggedIn: true } and the cookie
//   POST /api/auth/logout    deletes the session and the cookie
//   POST /api/auth/theme     { theme: 'light' | 'dark' }   keeps a logged-in visitor's theme with their session

const COOKIE = 'bgg_session';
const REFRESH_EARLY_MS = 5 * 60_000; // refresh a token this close to expiring
const MAX_AGE_S = 90 * 86_400;

function parseCookies(header) {
    const out = {};
    for (const part of String(header ?? '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const name = part.slice(0, i).trim();
        if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
    }
    return out;
}

function createAuth({
    sessions,
    clientId = process.env.STARTGG_CLIENT_ID,
    clientSecret = process.env.STARTGG_CLIENT_SECRET,
    redirectUri = process.env.STARTGG_REDIRECT_URI || 'http://localhost:4200/callback',
    tokenUrl = process.env.STARTGG_TOKEN_URL || 'https://api.start.gg/oauth/access_token',
    refreshUrl = process.env.STARTGG_REFRESH_URL || 'https://api.start.gg/oauth/refresh',
    siteToken = process.env.STARTGG_SITE_TOKEN,
    secureCookie = process.env.COOKIE_SECURE !== 'false',
    scope = 'user.identity',
    now = () => Date.now(),
    fetchImpl = fetch,
}) {
    const refreshing = new Map(); // session id -> Promise<'ok' | 'ended' | 'failed'>

    const cookie = (value, maxAge) =>
        `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
    const setCookie = (res, id) => res.append('Set-Cookie', cookie(id, MAX_AGE_S));
    const clearCookie = res => res.append('Set-Cookie', cookie('', 0));
    const sessionId = req => parseCookies(req.get('cookie'))[COOKIE] || null;

    // Asks start.gg for tokens. `rejected` means start.gg said no (a bad code or refresh token);
    // otherwise a failure is start.gg being down or unreachable.
    async function askStartgg(url, body) {
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({ ...body, client_id: clientId, client_secret: clientSecret, scope, redirect_uri: redirectUri }),
                signal: AbortSignal.timeout(15_000),
            });
            const json = await res.json().catch(() => null);
            if (res.ok && typeof json?.access_token === 'string') return { ok: true, json };
            console.error(`start.gg ${url.split('/').pop()}: HTTP ${res.status}`);
            return { ok: false, status: res.status, rejected: res.status >= 400 && res.status < 500 && res.status !== 429 };
        } catch (error) {
            console.error(`start.gg ${url.split('/').pop()}: ${error.message}`);
            return { ok: false, status: 502, rejected: false };
        }
    }

    const tokensFrom = (json, old = {}) => ({
        access: json.access_token,
        refresh: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : old.refresh,
        expiresAt: now() + (Number(json.expires_in) > 0 ? Number(json.expires_in) : 7 * 86_400) * 1000,
    });

    // Refreshes a session's token, once at a time per session. 'ended' when start.gg refused it.
    function refresh(id, session) {
        let pending = refreshing.get(id);
        if (!pending) {
            pending = (async () => {
                const answer = await askStartgg(refreshUrl, { grant_type: 'refresh_token', refresh_token: session.refresh });
                if (answer.ok) {
                    sessions.update(id, tokensFrom(answer.json, session));
                    return 'ok';
                }
                if (answer.rejected) {
                    sessions.delete(id);
                    return 'ended';
                }
                return 'failed';
            })().finally(() => refreshing.delete(id));
            refreshing.set(id, pending);
        }
        return pending;
    }

    // The session behind this request with a usable token, refreshed if needed. Ends the session
    // (cookie and x-session: ended) when start.gg refused its refresh token.
    async function freshSession(req, res, { force = false } = {}) {
        const id = sessionId(req);
        if (!id) return null;
        const session = sessions.get(id);
        if (!session) {
            clearCookie(res);
            return null;
        }
        if (force || session.expiresAt - now() < REFRESH_EARLY_MS) {
            const result = await refresh(id, session);
            if (result === 'ended') {
                clearCookie(res);
                res.set('x-session', 'ended');
                return null;
            }
        }
        const current = sessions.get(id);
        // A failed refresh keeps the session; its old token still works if it hasn't expired yet
        return current && current.expiresAt > now() ? { id, session: current } : null;
    }

    // Who a /api/gql request runs as: the visitor's own token, or the site's for visitors who aren't
    // logged in. null when neither is available. `onUnauthorized` gives the token to retry with after
    // start.gg answered 401 to this one.
    async function tokenFor(req, res) {
        const site = siteToken ? { kind: 'site', authorization: `Bearer ${siteToken}` } : null;
        const found = await freshSession(req, res);
        if (!found) return site;
        return {
            kind: 'user',
            authorization: `Bearer ${found.session.access}`,
            onUnauthorized: async () => {
                if (res.headersSent) return site;
                const again = await freshSession(req, res, { force: true });
                return again ? { kind: 'user', authorization: `Bearer ${again.session.access}` } : site;
            },
        };
    }

    async function session(req, res) {
        res.set('cache-control', 'no-store');
        const found = await freshSession(req, res);
        res.json({ loggedIn: !!found, ...(found?.session.theme ? { theme: found.session.theme } : {}) });
    }

    async function token(req, res) {
        res.set('cache-control', 'no-store');
        const code = req.body?.code;
        if (typeof code !== 'string' || code.length < 1 || code.length > 2048 || !/^[\w\-.~+/=%]+$/.test(code))
            return res.status(400).json({ error: 'Send the login code from start.gg.' });
        if (!clientId || !clientSecret)
            return res.status(503).json({ error: 'Logging in is not set up on this server.' });

        const answer = await askStartgg(tokenUrl, { grant_type: 'authorization_code', code });
        if (!answer.ok)
            return res.status(answer.rejected ? 400 : 502).json({ error: answer.rejected ? 'start.gg did not accept the login code.' : 'Could not reach start.gg.' });

        const old = sessionId(req);
        if (old) sessions.delete(old);
        setCookie(res, sessions.create(tokensFrom(answer.json)));
        res.json({ loggedIn: true });
    }

    function logout(req, res) {
        res.set('cache-control', 'no-store');
        const id = sessionId(req);
        if (id) sessions.delete(id);
        clearCookie(res);
        res.json({ loggedIn: false });
    }

    // The light or dark theme a logged-in visitor chose. The browser remembers it too; this copy
    // gives it back when the browser forgot.
    function theme(req, res) {
        res.set('cache-control', 'no-store');
        const chosen = req.body?.theme;
        if (chosen !== 'light' && chosen !== 'dark') return res.status(400).json({ error: 'Send theme: "light" or "dark".' });
        const id = sessionId(req);
        if (!id || !sessions.get(id)) return res.status(401).json({ error: 'Not logged in.' });
        sessions.update(id, { theme: chosen });
        res.json({ theme: chosen });
    }

    return { tokenFor, session, token, logout, theme };
}

module.exports = { createAuth, parseCookies };
