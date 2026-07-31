// Regenerates src/lib/test/gfm-conformance/spec-examples.json from a downloaded
// CommonMark spec.json (path in argv[2]; fetch it from https://spec.commonmark.org/, which
// is not committed). Keeps only inline-only examples so the conformance differ compares
// like for like; the inline guard duplicates reference.ts on purpose, so this stays
// runnable with plain `node`. Output is JSON with escaped strings so hard-break bytes and
// CRs survive LF normalization.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'commonmark';

// Read from the pinned devDependency rather than written down again: `reference.ts`'s
// REFERENCE_VERSION already asserts against this same field, so a literal here would be a
// third copy that can disagree with the corpus it labels.
const REFERENCE_VERSION = JSON.parse(
	readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
).devDependencies.commonmark;

const parser = new Parser();

function isInlineOnly(markdown) {
	const doc = parser.parse(markdown);
	const first = doc.firstChild;
	return Boolean(first && first.type === 'paragraph' && !first.next);
}

const specPath = process.argv[2];
if (!specPath) {
	console.error('usage: node scripts/extract-spec-examples.mjs <path-to-spec.json>');
	process.exit(1);
}

// spec.json carries no version of its own, so the stamp cannot be read off the input. The
// download path usually keeps one; disagreeing there would mislabel the corpus.
const versionInPath = specPath.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
if (versionInPath && versionInPath[1] !== REFERENCE_VERSION) {
	console.error(
		`extract-spec-examples: ${specPath} looks like spec ${versionInPath[1]}, but the pinned ` +
			`reference implementation is ${REFERENCE_VERSION}. Download the matching spec.json.`
	);
	process.exit(1);
}

const specExamples = JSON.parse(readFileSync(specPath, 'utf8'));
const examples = specExamples
	.filter((entry) => isInlineOnly(entry.markdown.replace(/\n$/, '')))
	.map(({ section, example, markdown }) => ({ section, example, markdown }));

const outPath = fileURLToPath(
	new URL('../src/lib/test/gfm-conformance/spec-examples.json', import.meta.url)
);
writeFileSync(
	outPath,
	JSON.stringify({ referenceVersion: REFERENCE_VERSION, examples }, null, '\t') + '\n'
);

console.log(
	`extract-spec-examples: ${examples.length} inline-only of ${specExamples.length} → ${outPath}`
);
