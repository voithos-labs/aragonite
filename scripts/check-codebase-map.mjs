// The codebase map names seams by path and symbol, so a moved seam must move the map. Every
// backticked span starting `src/`, `docs/`, or `scripts/` must resolve on disk, and a symbol
// written after `::` must appear word-bounded in that file. The check is existence, not
// correctness: a renamed symbol still mentioned in a comment passes, and so does a stale claim
// about a file that still exists. Fenced blocks are exempt.
import { existsSync, readFileSync, statSync } from 'node:fs';

const MAP_FILE = 'docs/contributing/codebase-map.md';
const REFERENCE_ROOT = /^(?:src|docs|scripts)\//;
const CODE_SPAN = /(`+)((?:(?!\1).)*?)\1/g;

if (!existsSync(MAP_FILE)) {
	console.error(`codebase-map: ${MAP_FILE} is missing`);
	process.exit(1);
}

// ── Parse ───────────────────────────────────────────────────────────────

// A fence holds diagrams and illustrative snippets that need not resolve; the map makes its
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

const text = stripFencedBlocks(readFileSync(MAP_FILE, 'utf8'));
const spans = [...text.matchAll(CODE_SPAN)].map((match) => ({
	content: match[2].trim(),
	start: match.index,
	end: match.index + match[0].length
}));

const references = [];
const malformed = [];
for (const [index, span] of spans.entries()) {
	// Both spellings, since a reader writes whichever renders better: two adjacent spans joined
	// by `::`, or one span holding the whole reference.
	const parts = span.content.split('::').map((part) => part.trim());
	if (!REFERENCE_ROOT.test(parts[0])) continue; // a backticked `Mod` or `focus` is prose
	if (parts.length > 2) {
		malformed.push(`\`${span.content}\` — a reference is \`path\` or \`path :: Symbol\``);
		continue;
	}
	const next = spans[index + 1];
	const joined = next !== undefined && /^\s*::\s*$/.test(text.slice(span.end, next.start));
	references.push({ path: parts[0], symbol: parts[1] ?? (joined ? next.content : undefined) });
}

// ── Verify ──────────────────────────────────────────────────────────────

function symbolPattern(symbol) {
	return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

const failures = [...malformed];
for (const { path, symbol } of references) {
	if (!existsSync(path)) {
		failures.push(`${path} — no such file or directory`);
		continue;
	}
	if (symbol === undefined) continue;
	if (statSync(path).isDirectory()) {
		failures.push(`${path} :: ${symbol} — a symbol reference must name a file`);
		continue;
	}
	if (!symbolPattern(symbol).test(readFileSync(path, 'utf8'))) {
		failures.push(`${path} :: ${symbol} — symbol not found in that file`);
	}
}

if (failures.length > 0) {
	console.error(`codebase-map: unresolved references in ${MAP_FILE}:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}

const named = references.filter((reference) => reference.symbol !== undefined).length;
console.log(
	`codebase-map: ${references.length} references resolve (${named} naming a symbol), ${MAP_FILE}`
);
