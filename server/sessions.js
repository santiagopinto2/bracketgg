// Logged-in visitors' start.gg tokens, kept on the server so the browser never sees them.
//
// The browser holds only a random session id in an HttpOnly cookie. This store keys each session by
// the id's SHA-256, so the file alone can't be turned back into cookies, and saves everything to one
// JSON file (SESSIONS_FILE, mode 600) so logins survive a restart. Writes go to a temporary file
// first and are renamed over the old one, so a crash mid-write never leaves half a file.
// Sessions unused for 90 days are dropped, and at most `maxSessions` are kept (the least recently
// used go first).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 86_400_000;

function createSessionStore({ file, now = () => Date.now(), idleMs = 90 * DAY, maxSessions = 5000, saveDelayMs = 500 } = {}) {
    const sessions = new Map(); // sha256(id) -> { access, refresh, expiresAt, createdAt, lastSeen }
    let saveTimer = null;
    let warned = false;

    const hash = id => crypto.createHash('sha256').update(String(id)).digest('hex');

    if (file) {
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const [key, session] of Object.entries(saved.sessions ?? {})) {
                if (session && typeof session.refresh === 'string') sessions.set(key, session);
            }
            console.log(`sessions: loaded ${sessions.size} from ${file}`);
        } catch (error) {
            if (error.code !== 'ENOENT') console.error(`sessions: could not read ${file}: ${error.message}`);
        }
    } else {
        console.warn('sessions: SESSIONS_FILE is not set, so logins last only until the server restarts');
    }

    function prune() {
        const cutoff = now() - idleMs;
        for (const [key, session] of sessions) if (session.lastSeen < cutoff) sessions.delete(key);
        if (sessions.size > maxSessions) {
            const oldest = [...sessions].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, sessions.size - maxSessions);
            for (const [key] of oldest) sessions.delete(key);
        }
    }

    function saveNow() {
        saveTimer = null;
        if (!file) return;
        prune();
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
            const tmp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) }), { mode: 0o600 });
            fs.renameSync(tmp, file);
            warned = false;
        } catch (error) {
            if (!warned) console.error(`sessions: could not save to ${file}: ${error.message}. Logins will be lost on restart.`);
            warned = true;
        }
    }

    const save = () => {
        if (!saveTimer) {
            saveTimer = setTimeout(saveNow, saveDelayMs);
            saveTimer.unref?.();
        }
    };

    // Saves the last-used times now and then, without a write per request
    const touchTimer = setInterval(save, 60 * 60_000);
    touchTimer.unref?.();

    return {
        // A new session for these tokens. Returns the id for the cookie.
        create(tokens) {
            const id = crypto.randomBytes(32).toString('base64url');
            const at = now();
            sessions.set(hash(id), { ...tokens, createdAt: at, lastSeen: at });
            save();
            return id;
        },
        // The session for a cookie's id, or null
        get(id) {
            if (typeof id !== 'string' || id.length < 20 || id.length > 100) return null;
            const session = sessions.get(hash(id));
            if (!session) return null;
            if (session.lastSeen < now() - idleMs) {
                sessions.delete(hash(id));
                save();
                return null;
            }
            session.lastSeen = now();
            return session;
        },
        update(id, tokens) {
            const session = sessions.get(hash(id));
            if (!session) return;
            Object.assign(session, tokens);
            save();
        },
        delete(id) {
            if (typeof id === 'string' && sessions.delete(hash(id))) save();
        },
        size: () => sessions.size,
        // Writes any pending change at once (for shutdown and tests)
        flush() {
            if (saveTimer) clearTimeout(saveTimer);
            saveNow();
        },
        stop() {
            clearInterval(touchTimer);
            if (saveTimer) { clearTimeout(saveTimer); saveNow(); }
        },
    };
}

module.exports = { createSessionStore };
