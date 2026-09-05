// Audit the defect ledger against docs/contributing/rules.md § Records: every issue carries a
// type and one `area:`, and `severity:` is defect-only. Fails on open issues alone, so a closed
// issue predating the forms is reported without blocking a run.
// Usage: node scripts/audit-issues.mjs
import { execFileSync } from 'node:child_process';

const OWNER = 'voithos-labs';
const REPO = 'aragonite';

// ── Read ────────────────────────────────────────────────

const QUERY = `query($o:String!,$r:String!,$after:String){
  repository(owner:$o,name:$r){
    issues(first:100,after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{
        number state
        issueType{ name }
        milestone{ title }
        labels(first:20){ nodes{ name } }
      }
    }
  }
}`;

function fetchIssues() {
	const issues = [];
	let after = null;
	for (;;) {
		const fields = [`o=${OWNER}`, `r=${REPO}`];
		if (after) fields.push(`after=${after}`);
		const page = JSON.parse(
			execFileSync(
				'gh',
				['api', 'graphql', '-f', `query=${QUERY}`, ...fields.flatMap((f) => ['-F', f])],
				{
					encoding: 'utf8',
					maxBuffer: 32 * 1024 * 1024
				}
			)
		).data.repository.issues;
		issues.push(...page.nodes);
		if (!page.pageInfo.hasNextPage) return issues;
		after = page.pageInfo.endCursor;
	}
}

// ── Report ──────────────────────────────────────────────

const labels = (issue) => issue.labels.nodes.map((node) => node.name);
const hasArea = (issue) => labels(issue).some((name) => name.startsWith('area:'));
const hasSeverity = (issue) => labels(issue).some((name) => name.startsWith('severity:'));
const isOpen = (issue) => issue.state === 'OPEN';

const numbers = (issues) => issues.map((issue) => `#${issue.number}`).join(' ') || 'none';

const issues = fetchIssues();
const open = issues.filter(isOpen);
const closed = issues.filter((issue) => !isOpen(issue));

const untypedOpen = open.filter((issue) => !issue.issueType);
const arealessOpen = open.filter((issue) => !hasArea(issue));
const untypedClosed = closed.filter((issue) => !issue.issueType);
const arealessClosed = closed.filter((issue) => !hasArea(issue));
const severityNotBug = issues.filter(
	(issue) => hasSeverity(issue) && issue.issueType?.name !== 'Bug'
);
const goodFirst = open.filter((issue) => labels(issue).includes('good first issue'));

const byType = (list) => {
	const counts = {};
	for (const issue of list) {
		const name = issue.issueType?.name ?? 'untyped';
		counts[name] = (counts[name] ?? 0) + 1;
	}
	return Object.entries(counts)
		.sort()
		.map(([name, n]) => `${name} ${n}`)
		.join(', ');
};

const milestones = {};
for (const issue of open) {
	const title = issue.milestone?.title ?? '(none)';
	milestones[title] = (milestones[title] ?? 0) + 1;
}

console.log(`ledger: ${issues.length} issues (${open.length} open, ${closed.length} closed)`);
console.log(`  open        ${byType(open)}`);
console.log(`  closed      ${byType(closed)}`);
console.log(
	`  open milestones  ${Object.entries(milestones)
		.sort()
		.map(([t, n]) => `${t} ${n}`)
		.join(', ')}`
);
console.log(`  good first issue ${goodFirst.length} open`);
console.log('');
console.log(`severity: without type Bug   ${severityNotBug.length}  ${numbers(severityNotBug)}`);
console.log(`closed, untyped              ${untypedClosed.length}  ${numbers(untypedClosed)}`);
console.log(`closed, no area:             ${arealessClosed.length}  ${numbers(arealessClosed)}`);
console.log('');
console.log(`OPEN, untyped                ${untypedOpen.length}  ${numbers(untypedOpen)}`);
console.log(`OPEN, no area:               ${arealessOpen.length}  ${numbers(arealessOpen)}`);

if (untypedOpen.length || arealessOpen.length) {
	console.error('\nfail: every open issue needs a type and one area: label');
	process.exit(1);
}
console.log('\nok: every open issue carries a type and an area:');
