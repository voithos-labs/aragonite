// Set an issue's type. `gh issue edit` cannot: types are GraphQL-only, so this is the door for
// an issue the forms did not type (one filed before the forms, or converted after triage).
// Usage: node scripts/issue-type.mjs <number> bug|task|feature
import { execFileSync } from 'node:child_process';

const OWNER = 'voithos-labs';
const REPO = 'aragonite';

// Defined on the voithos-labs org and served through the repo. Re-read them with:
//   gh api graphql -f query='{repository(owner:"voithos-labs",name:"aragonite"){issueTypes(first:10){nodes{id name}}}}'
const TYPE_IDS = {
	bug: 'IT_kwDOCKksYc4BN-O0',
	task: 'IT_kwDOCKksYc4BN-Oy',
	feature: 'IT_kwDOCKksYc4BN-O4'
};

const [number, type] = process.argv.slice(2);
if (!/^\d+$/.test(number ?? '') || !(type in TYPE_IDS)) {
	console.error('usage: node scripts/issue-type.mjs <number> bug|task|feature');
	process.exit(2);
}

// gh exits non-zero on a GraphQL error, so its own message is the useful one; a stack trace here
// would only say that a subprocess failed.
function graphql(query, fields = []) {
	try {
		return JSON.parse(
			execFileSync(
				'gh',
				['api', 'graphql', '-f', `query=${query}`, ...fields.flatMap((f) => ['-F', f])],
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
			)
		);
	} catch (failure) {
		console.error(String(failure.stderr ?? failure.message).trim());
		process.exit(1);
	}
}

const issue = graphql(
	'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}',
	[`o=${OWNER}`, `r=${REPO}`, `n=${number}`]
).data.repository.issue;

const updated = graphql(
	`mutation{updateIssue(input:{id:"${issue.id}",issueTypeId:"${TYPE_IDS[type]}"}){issue{number issueType{name}}}}`
).data.updateIssue.issue;

console.log(`#${updated.number} is now ${updated.issueType.name}`);
