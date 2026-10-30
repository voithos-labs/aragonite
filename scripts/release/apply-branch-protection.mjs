// One-shot: apply branch protection, `node scripts/release/apply-branch-protection.mjs [main|dev]` (default
// main). Needs gh authenticated as a repo admin. `main` requires the checks in
// `branch-protection-contexts.mjs` and a code owner's review; `dev` only moves forward, since
// contributors branch from it, so it blocks force pushes and deletion and nothing else.
import { execFileSync } from 'node:child_process';
import { CI_CONTEXTS, EXTERNAL_CONTEXTS } from './branch-protection-contexts.mjs';

const REPO = 'voithos-labs/aragonite';

const RULES = {
	main: {
		required_status_checks: {
			// Not strict: a PR need not be rebased onto every push to main first. A run takes tens of
			// minutes, so strict mode would re-queue every open PR on every merge, and the run on push
			// to main catches what a stale base lets through.
			strict: false,
			contexts: [...CI_CONTEXTS, ...Object.values(EXTERNAL_CONTEXTS).flat()]
		},
		// Admins stay exempt, so a maintainer can still merge when the other one is unreachable.
		enforce_admins: false,
		// Present with a count of 1, so every change arrives as a PR and an outside fork's PR needs
		// a maintainer's approval. Both maintainers are code owners, so either can approve the other.
		required_pull_request_reviews: {
			dismiss_stale_reviews: true,
			require_code_owner_reviews: true,
			required_approving_review_count: 1
		},
		// Null is "anyone with write may push"; a list here would be a second, narrower gate on top
		// of the reviews.
		restrictions: null,
		allow_force_pushes: false,
		allow_deletions: false,
		required_conversation_resolution: true
	},
	dev: {
		// No checks and no reviews: GitHub applies them to every commit landing on the branch, which
		// would refuse the maintainers' gated pushes. Contributor PRs still run CI before a merge.
		required_status_checks: null,
		required_pull_request_reviews: null,
		// Admins included, so the two blocks below bind the maintainers too.
		enforce_admins: true,
		restrictions: null,
		allow_force_pushes: false,
		allow_deletions: false
	}
};

const BRANCH = process.argv[2] ?? 'main';
const protection = RULES[BRANCH];
if (!protection) {
	console.error(
		`usage: node scripts/release/apply-branch-protection.mjs [${Object.keys(RULES).join('|')}]`
	);
	process.exit(1);
}

const endpoint = `repos/${REPO}/branches/${BRANCH}/protection`;

try {
	execFileSync('gh', ['api', '-X', 'PUT', endpoint, '--input', '-'], {
		input: JSON.stringify(protection),
		encoding: 'utf8'
	});
} catch (err) {
	const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`;
	if (detail.includes('Upgrade to GitHub Pro')) {
		console.error(
			`${BRANCH} protection NOT applied: the API plan-gates this on private free-plan repos.`
		);
		process.exit(1);
	}
	throw err;
}

// Read back rather than echo the payload: the API silently drops fields a plan or a repo
// setting does not support, so what landed is the only thing worth printing.
console.log(`${BRANCH} branch protection applied. Live rule:`);
console.log(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
