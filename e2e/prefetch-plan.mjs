// Tests src/app/services/phase-prefetch-plan.ts: which of an event's phases load in the background
// (phase-prefetch.ts), in what order, and the request budget.
// Usage: node e2e/prefetch-plan.mjs   Prints a JSON report and exits 1 if a check fails. Needs Node 22.18+.
const { planPrefetch, estimatePhase, PrefetchBudget, PREFETCH_LIMITS } = await import('../src/app/services/phase-prefetch-plan.ts');

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });
const ids = plan => plan.map(phase => phase.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Shaped like Genesis X Melee Singles: 64 first-round pools, 16 second-round pools, a top 64 and a top 8,
// each phase filled from the one before, and an exhibition with a few players
const genesis = [
    { id: 1, name: 'R1 Pools', numSeeds: 1536, groupCount: 64, progressingInData: [] },
    { id: 2, name: 'R2 Pools', numSeeds: 384, groupCount: 16, progressingInData: [{ origin: 1, numProgressing: 384 }] },
    { id: 3, name: 'Top 64', numSeeds: 64, groupCount: 1, progressingInData: [{ origin: 2, numProgressing: 64 }] },
    { id: 4, name: 'Top 8', numSeeds: 8, groupCount: 1, progressingInData: [{ origin: 3, numProgressing: 8 }] },
    { id: 5, name: 'Exhibition', numSeeds: 16, groupCount: 1, progressingInData: [] },
];
const cost = plan => plan.reduce((n, phase) => n + estimatePhase(phase, genesis, true).requests, 0);

{
    const plan = planPrefetch(genesis, 1, true, true);
    check('logged in, from R1 Pools: every other phase, the cheapest first and, of equals, the one later in the list first',
        same(ids(plan), [5, 4, 3, 2]) && cost(plan) <= PREFETCH_LIMITS.loggedIn.maxRequests, { plan: ids(plan), requests: cost(plan) });
}
{
    const plan = planPrefetch(genesis, 4, true, true);
    check('logged in, from Top 8: the big pool phases too, within 120 requests', same(ids(plan), [5, 3, 2, 1]) && cost(plan) <= 120,
        { plan: ids(plan), requests: cost(plan), estimates: genesis.map(phase => [phase.id, estimatePhase(phase, genesis, true)]) });
}
{
    const plan = planPrefetch(genesis, 4, false, true);
    check('not logged in, from Top 8: only the phases whose sets fit in one or two requests, never the pool phases',
        same(ids(plan), [5, 3]) && plan.every(phase => estimatePhase(phase, genesis, true).setRequests <= 2), ids(plan));
}
{
    // Top 64's sets take two requests (about 128 sets), and the seeds of the Top 8 it fills one more
    const top64 = estimatePhase(genesis[2], genesis, true);
    const r1 = estimatePhase(genesis[0], genesis, true);
    check('estimates: Top 64 is the phase, its players, two of sets and the Top 8\'s seeds; R1 Pools far more than a visitor gets',
        top64.requests === 5 && top64.setRequests === 2 && r1.setRequests > 2, { top64, r1 });
}
{
    const many = Array.from({ length: 300 }, (_, i) => ({ id: 100 + i, numSeeds: 8, groupCount: 1 }));
    const loggedIn = planPrefetch(many, 100, true, true);
    const visitor = planPrefetch(many, 100, false, true);
    check('hard limits: at most 40 phases logged in, and 15 requests (5 small phases) not logged in; never the shown phase',
        loggedIn.length === PREFETCH_LIMITS.loggedIn.maxPhases && visitor.length === 5 && !ids(loggedIn).includes(100) && !ids(visitor).includes(100),
        { loggedIn: loggedIn.length, visitor: visitor.length });
}
{
    const huge = [{ id: 1, numSeeds: 8, groupCount: 1 }, { id: 2, numSeeds: 20000, groupCount: 400 }];
    check('a phase estimated past 60 requests is left out even logged in', same(ids(planPrefetch(huge, 1, true, true)), []), estimatePhase(huge[1], huge, true));
    check('no phases, or a broken list, plans nothing', planPrefetch(null, 1, true, true).length === 0 && planPrefetch([null, {}], 1, true, true).length === 0);
}
{
    const budget = new PrefetchBudget(PREFETCH_LIMITS.loggedIn);
    const first = Array.from({ length: 40 }, () => budget.take(1000));
    const wait = budget.take(1000);
    const later = budget.take(61_001);
    for (let t = 200_000; budget.used < 120; t += 60_001) for (let i = 0; i < 40; i++) budget.take(t);
    check('budget: 40 requests in a minute, then a wait until the oldest is a minute old; nothing after 120',
        first.every(w => w === 0) && wait === 60_000 && later === 0 && budget.used === 120 && budget.take(10_000_000) === Infinity, { wait, later, used: budget.used });
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
