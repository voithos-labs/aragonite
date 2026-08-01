/**
 * The tableCell raw-write seam. A cell's raw is joined verbatim into its row and the
 * parser truncates a row that reparses wider than the delimiter's column count, so one
 * unescaped `|` silently deletes the last column's content. The hook the rule rides is
 * pinned in `leaf-raw-write-rule`; what is cell-specific lives here: one implementation
 * of the escape, and the caret half no seam can absorb — the sink's inserted backslashes
 * move the offset a caller reports.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const CELL = 'src/lib/components/blocks/table/TableCellBlock.svelte';

/** The rule itself has one implementation; a second is what let two escapes disagree. */
const RULE_HOME = 'src/lib/schema/table-cell-raw.ts';
const RULE_READERS: Record<string, string> = {
	[RULE_HOME]: 'the implementation',
	'src/lib/schema/built-in-descriptors.ts': 'the tableCell declaration',
	'src/lib/components/blocks/table/table-cell-paste.ts': 'escapedCellOffset, the caret image'
};

const CAPABILITY = /\bnormalizeRawWrite\b/;
// `?.` included: an optional-chained bundle write is the same write, and only the
// receiver-name rule below stands between it and a bare raw.
const WRITE_CALL = /\b(\w+)\??\.updateBlockContent\s*\(/g;
const CONTEXT_BIND =
	/\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*getContext<[^>]*>\(\s*BLOCK_EDIT_KEY/g;

function receivers(code: string): string[] {
	return [...code.matchAll(WRITE_CALL)].map((m) => m[1]);
}

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('the tableCell escape has one implementation', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the documented readers name the rule (no second implementation)', () => {
		expect(namesInCode(sources, /\bnormalizeCellRaw\b/)).toEqual(Object.keys(RULE_READERS).sort());
	});

	it('the escape primitive is named only in its schema home', () => {
		expect(namesInCode(sources, /\bescapeUnescapedPipes\b/)).toEqual([RULE_HOME]);
	});
});

describe('every cell content write routes through the caret-mapping wrapper', () => {
	const sources = collectEditorSources();

	it('the cell writes the raw bundle exactly once — the wrapper itself', () => {
		const cell = sources.find((f) => f.relPath === CELL);
		expect(cell, `${CELL} not found`).toBeDefined();
		const raw = receivers(cell!.code).filter((name) => name === 'parentBlockEdit');
		expect(raw).toEqual(['parentBlockEdit']);
	});

	// Repo-wide, not table-only: a content write grabbing an unwrapped bundle is the shape
	// that lost the escape three times.
	it('no content write anywhere names anything but the wrapper or that one raw write', () => {
		const offenders = sources.flatMap((f) =>
			receivers(f.code)
				.filter((name) => name !== 'blockEdit')
				.filter((name) => !(f.relPath === CELL && name === 'parentBlockEdit'))
				.map((name) => `${f.relPath}: ${name}.updateBlockContent(`)
		);
		expect(offenders).toEqual([]);
	});

	it('every table file binds the block-edit context under the parent-scoped name', () => {
		const tableSources = sources.filter((f) =>
			f.relPath.startsWith('src/lib/components/blocks/table/')
		);
		expect(tableSources.length).toBeGreaterThan(0);
		const offenders = tableSources.flatMap((f) =>
			[...f.code.matchAll(CONTEXT_BIND)]
				.map((m) => m[1])
				.filter((name) => name !== 'parentBlockEdit')
				.map((name) => `${f.relPath}: ${name}`)
		);
		expect(offenders).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the write matcher catches an optional-chained bundle write', () => {
		expect(receivers('void parentBlockEdit?.updateBlockContent(i, text);')).toEqual([
			'parentBlockEdit'
		]);
	});

	it('the write matcher reads through a qualified receiver', () => {
		expect(receivers('deps.blockEdit.updateBlockContent(i, text);')).toEqual(['blockEdit']);
	});

	it('a capability mention inside a comment cannot satisfy the scan', () => {
		const commented = collectEditorSources().find((f) => f.relPath === CELL)!;
		expect(CAPABILITY.test(commented.text)).toBe(true);
		expect(CAPABILITY.test(commented.code)).toBe(false);
	});
});
