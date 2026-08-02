// One-shot: apply main-branch protection. Run at the flip to public; the API plan-gates
// protection on private free-plan repos (403 until then), and it needs gh authenticated as
// a repo admin. Contexts must match ci.yml's job names exactly, so a job rename updates
// this list. The bypass allowance exempts the owner from the code-owner review only; the
// status checks stay binding on everyone.
import { execFileSync } from 'node:child_process';

const protection = {
	required_status_checks: {
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
	enforce_admins: true,
	required_pull_request_reviews: {
		dismiss_stale_reviews: true,
		require_code_owner_reviews: true,
		require_last_push_approval: true,
		required_approving_review_count: 1,
		bypass_pull_request_allowances: { users: ['DanielZFLiu'], teams: [], apps: [] }
	},
	// Null is "anyone with write may push"; a list here would be a second, narrower gate on
	// top of the reviews. Set one once more maintainers hold write.
	restrictions: null,
	allow_force_pushes: false,
	allow_deletions: false,
	required_conversation_resolution: true
};

const out = execFileSync(
	'gh',
	['api', '-X', 'PUT', 'repos/voithos-labs/aragonite/branches/main/protection', '--input', '-'],
	{ input: JSON.stringify(protection), encoding: 'utf8' }
);
console.log('main branch protection applied:');
console.log(out);
