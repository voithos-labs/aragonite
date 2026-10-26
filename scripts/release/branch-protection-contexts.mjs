// The status checks `main` requires, and the engine checks that report but don't gate yet. Read by
// `apply-branch-protection.mjs`, by `check-release-gates.mjs`, and by
// `src/lib/test/invariants/lint/branch-protection-contexts.test.ts`, which holds both lists to what
// the workflows report. Each matrix check is spelled the way GitHub names it.

/** @param {string} job @param {number} count */
const shards = (job, count) =>
	Array.from({ length: count }, (_, i) => `${job} (${i + 1}/${count})`);

/** Every check ci.yml reports that `main` requires. */
export const CI_CONTEXTS = [
	'changes',
	'unit',
	...shards('e2e', 4),
	'perf',
	'consumer-smoke',
	'adapter-smoke',
	'emoji-table',
	...shards('e2e-webkit', 5),
	'firefox',
	...shards('e2e-firefox', 8),
	'e2e-census'
];

/** Checks reported from outside ci.yml that `main` requires, by the workflow that reports them. */
export const EXTERNAL_CONTEXTS = { 'webkit-macos.yml': shards('e2e-webkit-macos', 5) };

/**
 * Engine checks that run red or green but aren't required yet, because the engine still has reds
 * with no fix, skip or fixme. Each one moves to a required list once its engine runs clean, and a
 * release refuses to publish while this list holds anything (`check-release-gates.mjs`).
 * @type {string[]}
 */
export const PENDING_GATE_CONTEXTS = [];
