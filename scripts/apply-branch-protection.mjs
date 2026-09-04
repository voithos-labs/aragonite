// One-shot: apply main-branch protection. Needs gh authenticated as a repo admin, and a repo
// the API will take it on: protection is plan-gated, so a private free-plan repo answers 403.
// Contexts are ci.yml's job names, held in step by
// `src/lib/test/invariants/lint/branch-protection-contexts.test.ts`. Admins are exempt so a
// maintainer is never locked out of their own repo when the other one is unreachable; the price
// is that an admin can also merge past a red check, deliberately and visibly.
//
// `main` alone is protected: `dev` is the integration branch and takes the repo-wide history
// rewrites, which need the force push this rule forbids.
import { execFileSync } from 'node:child_process';

const REPO = 'voithos-labs/aragonite';
const BRANCH = 'main';

const protection = {
	required_status_checks: {
		// Not strict: a PR need not be rebased onto every push to main first. The matrix costs
		// ~20 minutes, so strict mode would re-queue every open PR on every merge, and the run on
		// push to main catches what a stale base lets through.
		strict: false,
		contexts: [
			'unit',
			'e2e (1/4)',
			'e2e (2/4)',
			'e2e (3/4)',
			'e2e (4/4)',
			'perf',
			'consumer-smoke',
			'emoji-table'
		]
	},
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
};

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
			`${BRANCH} protection NOT applied: the API plan-gates this on private free-plan repos.\n` +
				'Expected before the flip to public. Re-run once the repo is public.'
		);
		process.exit(1);
	}
	throw err;
}

// Read back rather than echo the payload: the API silently drops fields a plan or a repo
// setting does not support, so what landed is the only thing worth printing.
console.log(`${BRANCH} branch protection applied. Live rule:`);
console.log(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
