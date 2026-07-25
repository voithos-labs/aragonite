// Gates the committed `emoji-table.ts` against its generator: re-renders the table
// from the pinned gemoji revision and byte-compares. A hand-edit, a half-finished
// regen, or a merge conflict resolved by hand fails here instead of shipping a table
// nothing can reproduce. Exits non-zero (naming the first divergent line) on drift.
//
//   node scripts/verify-emoji-table.mjs                 # fetch the pinned gemoji db
//   node scripts/verify-emoji-table.mjs --input db.json # verify against a local copy
//
// Deliberately NOT a unit test: it reaches the network, and the unit suite must not.
// CI runs it as its own job (.github/workflows/ci.yml) so a drift reads as drift
// rather than as a mystery failure inside the editor suites.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	EMOJI_TABLE_PATH,
	emojiTableEntries,
	loadGemojiDb,
	renderEmojiTable
} from './generate-emoji-table.mjs';

/**
 * Report where the two renderings part company. A bare "they differ" is unactionable
 * across ~1,900 rows; the first divergent line names the offending shortcode.
 * @param {string} generated
 * @param {string} committed
 */
function reportDrift(generated, committed) {
	const generatedLines = generated.split('\n');
	const committedLines = committed.split('\n');
	const lineCount = Math.max(generatedLines.length, committedLines.length);
	const at = Array.from({ length: lineCount }, (_, i) => i).find(
		(i) => generatedLines[i] !== committedLines[i]
	);
	const show = (/** @type {string | undefined} */ line) =>
		line === undefined ? '<end of file>' : JSON.stringify(line);
	console.error(
		`verify-emoji-table: ${EMOJI_TABLE_PATH} is not what the generator produces.\n` +
			`  first divergence at line ${(at ?? 0) + 1}\n` +
			`    committed: ${show(committedLines[at ?? 0])}\n` +
			`    generated: ${show(generatedLines[at ?? 0])}\n` +
			`  line counts: committed ${committedLines.length}, generated ${generatedLines.length}\n` +
			`  regenerate with: node scripts/generate-emoji-table.mjs`
	);
}

/** @param {string[]} argv */
function parseInput(argv) {
	const at = argv.indexOf('--input');
	return at === -1 ? undefined : argv[at + 1];
}

const input = parseInput(process.argv.slice(2));
const committed = await readFile(path.resolve(EMOJI_TABLE_PATH), 'utf8');
const entries = emojiTableEntries(await loadGemojiDb(input));
const generated = renderEmojiTable(entries);

if (generated !== committed) {
	reportDrift(generated, committed);
	process.exit(1);
}

console.log(
	`verify-emoji-table: OK (${entries.length} shortcodes, byte-identical to ${EMOJI_TABLE_PATH})`
);
