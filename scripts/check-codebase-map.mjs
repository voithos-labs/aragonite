// The design and contributing docs name seams by path and symbol, so a moved seam must move the
// docs. Every backticked span starting `src/`, `docs/`, or `scripts/` must resolve on disk, and a
// symbol written after `::` must appear word-bounded in that file. The check is existence, not
// correctness: a renamed symbol still mentioned in a comment passes, and so does a stale claim
// about a file that still exists. Fenced blocks are exempt.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const DOC_DIRS = ['docs/design', 'docs/contributing'];
const REFERENCE_ROOT = /^(?:src|docs|scripts)\//;
const CODE_SPAN = /(`+)((?:(?!\1).)*?)\1/g;

const files = DOC_DIRS.flatMap((dir) => {
	if (!existsSync(dir)) {
		console.error(`codebase-map: ${dir} is missing`);
		process.exit(1);
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => `${dir}/${name}`);
});

// ── Parse ───────────────────────────────────────────────────────────────

// A fence holds diagrams and illustrative snippets that need not resolve; the docs make their
// claims in inline code, so this blanks the opposite half of what the docs-link gate blanks.
function stripFencedBlocks(text) {
	let fence = null;
	return text
		.split('\n')
		.map((line) => {
			const fenceMark = line.match(/^\s*(```+|~~~+)/);
			if (fence) {
				if (fenceMark && line.trim().startsWith(fence)) fence = null;
				return '';
			}
			if (fenceMark) {
				fence = fenceMark[1][0].repeat(3);
				return '';
			}
			return line;
		})
		.join('\n');
}

const references = [];
const malformed = [];
for (const file of files) {
	const text = stripFencedBlocks(readFileSync(file, 'utf8'));
	const spans = [...text.matchAll(CODE_SPAN)].map((match) => ({
		content: match[2].trim(),
		start: match.index,
		end: match.index + match[0].length
	}));
	for (const [index, span] of spans.entries()) {
		// Both spellings, since a reader writes whichever renders better: two adjacent spans joined
		// by `::`, or one span holding the whole reference.
		const parts = span.content.split('::').map((part) => part.trim());
		if (!REFERENCE_ROOT.test(parts[0])) continue; // a backticked `Mod` or `focus` is prose
		if (parts.length > 2) {
			malformed.push(
				`${file}: \`${span.content}\` — a reference is \`path\` or \`path :: Symbol\``
			);
			continue;
		}
		const next = spans[index + 1];
		const joined = next !== undefined && /^\s*::\s*$/.test(text.slice(span.end, next.start));
		references.push({
			file,
			path: parts[0],
			symbol: parts[1] ?? (joined ? next.content : undefined)
		});
	}
}

// ── Verify ──────────────────────────────────────────────────────────────

// A `<name>` placeholder or a `*` glob names a family, so only its concrete prefix can be checked:
// `src/lib/plugins/<name>` still has to have a `src/lib/plugins`.
function concretePrefix(path) {
	const segments = path.split('/');
	const wildcard = segments.findIndex((segment) => /[<*]/.test(segment));
	return wildcard === -1 ? path : segments.slice(0, wildcard).join('/');
}

function symbolPattern(symbol) {
	return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

const failures = [...malformed];
for (const { file, path, symbol } of references) {
	const checked = concretePrefix(path);
	if (!existsSync(checked)) {
		const detail = checked === path ? '' : ` (\`${checked}\`)`;
		failures.push(`${file}: ${path}${detail} — no such file or directory`);
		continue;
	}
	if (symbol === undefined || checked !== path) continue;
	if (statSync(path).isDirectory()) {
		failures.push(`${file}: ${path} :: ${symbol} — a symbol reference must name a file`);
		continue;
	}
	if (!symbolPattern(symbol).test(readFileSync(path, 'utf8'))) {
		failures.push(`${file}: ${path} :: ${symbol} — symbol not found in that file`);
	}
}

if (failures.length > 0) {
	console.error(`codebase-map: unresolved references in ${DOC_DIRS.join(', ')}:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}

const named = references.filter((reference) => reference.symbol !== undefined).length;
console.log(
	`codebase-map: ${references.length} references resolve (${named} naming a symbol) across ${files.length} files in ${DOC_DIRS.join(', ')}`
);
