/**
 * G4.218: an invariant catalog entry (from a paragraph opening `**G<n>.<m> ·` in a group file under
 * `docs/design/invariants/` to the next entry or heading) holds at most six text lines and 600
 * characters, so it carries the rule, its why and its files rather than the mechanism. The
 * baseline only shrinks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectFiles } from './scan-source';
import { SOURCE_DIR } from './source-paths';

const MAX_LINES = 6;
// Six lines at Prettier's 100 columns, so long lines can't stand in for more of them.
const MAX_CHARS = 600;

/** Entries allowed past the budget, keyed `file:G-number`, each with why it needs the room. */
const BASELINE: Record<string, string> = {
	'docs/design/invariants/scans.md:G4.36': 'three file lists, each a case a caret writer must know',
	'docs/design/invariants/scans.md:G4.75': 'seven write steps, each with its own allowed files',
	'docs/design/invariants/scans.md:G4.131': 'three syntax modules, each with its own row and tests'
};

interface CatalogEntry {
	file: string;
	id: string;
	lines: number;
	chars: number;
}

const ENTRY_START = /^\*\*(G\d+\.\d+) ·/;

function catalogEntries(file: string, markdown: string): CatalogEntry[] {
	const lines = markdown.split(/\r?\n/);
	const entries: CatalogEntry[] = [];
	for (let i = 0; i < lines.length; i++) {
		const id = ENTRY_START.exec(lines[i])?.[1];
		if (!id) continue;
		let end = i + 1;
		while (end < lines.length && !ENTRY_START.test(lines[end]) && !lines[end].startsWith('#')) {
			end++;
		}
		const text = lines.slice(i, end).filter((line) => line.trim() !== '');
		entries.push({ file, id, lines: text.length, chars: text.join(' ').length });
		i = end - 1;
	}
	return entries;
}

const isOver = (e: CatalogEntry) => e.lines > MAX_LINES || e.chars > MAX_CHARS;
const keyOf = (e: CatalogEntry) => `${e.file}:${e.id}`;
const describeEntry = (e: CatalogEntry) =>
	`${e.file} ${e.id}: ${e.lines} lines, ${e.chars} characters`;

describe('G4.218 an invariant catalog entry stays within six lines', () => {
	const files = collectFiles(SOURCE_DIR.invariantCatalog, { extensions: ['.md'] });
	const entries = files.flatMap((file) => catalogEntries(file, readFileSync(file, 'utf8')));

	it('reads every group file and finds their entries', () => {
		for (const group of ['runtime', 'tested', 'compile-time', 'scans']) {
			const file = `${SOURCE_DIR.invariantCatalog}${group}.md`;
			expect(entries.filter((e) => e.file === file).length, file).toBeGreaterThan(10);
		}
	});

	it('no entry outside the baseline runs past the budget', () => {
		const over = entries.filter((e) => isOver(e) && !(keyOf(e) in BASELINE));
		expect(over.map(describeEntry)).toEqual([]);
	});

	it('every baseline entry is still over (delete its row once it fits)', () => {
		const overKeys = new Set(entries.filter(isOver).map(keyOf));
		expect(Object.keys(BASELINE).filter((key) => !overKeys.has(key))).toEqual([]);
	});

	// ── Reader self-tests ───────────────────────────────────────────────────

	const entry = (n: number, width = 10, id = 'G9.1') =>
		[`**${id} · Name.**`, ...Array.from({ length: n - 1 }, () => 'x'.repeat(width))].join('\n');
	const sizes = (markdown: string) =>
		catalogEntries('f.md', markdown).map((e) => [e.id, e.lines, isOver(e)]);

	it('a seven-line entry is over and a six-line one is not', () => {
		expect(sizes(entry(7))).toEqual([['G9.1', 7, true]]);
		expect(sizes(entry(6))).toEqual([['G9.1', 6, false]]);
	});

	it('six long lines are over on characters', () => {
		expect(sizes(entry(6, 99))).toEqual([['G9.1', 6, false]]);
		expect(sizes(entry(6, 130))).toEqual([['G9.1', 6, true]]);
	});

	it('a later paragraph or list counts, up to the next entry or heading', () => {
		const split = `${entry(4)}\n\n- a\n- b\n\nc\n\n${entry(2, 10, 'G9.2')}\n\n## Next\n\nd`;
		expect(sizes(split)).toEqual([
			['G9.1', 7, true],
			['G9.2', 2, false]
		]);
	});

	it('CRLF counts the same as LF', () => {
		expect(sizes(entry(7).replace(/\n/g, '\r\n'))).toEqual([['G9.1', 7, true]]);
	});

	it('a table row, a heading and a mid-paragraph G-number are not entries', () => {
		const markdown = '| G4.1 | row |\n\n## G4.2 · heading\n\nsee **G4.3 · Name.** here';
		expect(catalogEntries('f.md', markdown)).toEqual([]);
	});
});
