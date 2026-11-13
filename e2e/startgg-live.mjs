// Asks the real start.gg, for the live checks. CI runs can overlap and share one token, so a 429
// ("Rate limit exceeded") waits and tries again, up to 5 times, instead of failing the run.
export async function askStartgg(token, query, variables) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(variables ? { query, variables } : { query }),
        });
        if (res.status === 429 && attempt < 5) {
            console.error(`start.gg rate limit, waiting 20 s (attempt ${attempt})`);
            await new Promise(r => setTimeout(r, 20_000));
            continue;
        }
        return { status: res.status, json: await res.json() };
    }
}
