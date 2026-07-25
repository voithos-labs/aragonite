// One-shot: apply main-branch protection. Run at the flip to public; the API
// plan-gates protection on private free-plan repos (HTTP 403 until then).
// Requires gh authenticated with repo admin.
// The contexts must match ci.yml's job names, so a job rename updates this list.
import { execFileSync } from 'node:child_process';

const protection = {
	required_status_checks: {
		strict: false,
		contexts: ['unit', 'e2e (1/4)', 'e2e (2/4)', 'e2e (3/4)', 'e2e (4/4)', 'perf', 'consumer-smoke']
	},
	enforce_admins: true,
	required_pull_request_reviews: { required_approving_review_count: 0 },
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
