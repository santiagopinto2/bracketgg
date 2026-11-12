// The query texts /api/gql runs: exactly the app's own, read from the file the app builds them from.
// Node 22.18 and later read the TypeScript file directly (type stripping).

const path = require('path');
const { pathToFileURL } = require('url');

const QUERIES_FILE = path.join(__dirname, '../src/app/services/startgg-queries.ts');

async function loadAllowlist(file = QUERIES_FILE) {
    const queries = await import(pathToFileURL(file).href);
    const allowed = new Set(queries.allQueries());
    if (!allowed.size) throw new Error(`no queries in ${file}`);
    return allowed;
}

module.exports = { loadAllowlist, QUERIES_FILE };
