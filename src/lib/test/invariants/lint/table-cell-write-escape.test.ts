/**
 * The tableCell raw-write seam. A cell's raw is joined verbatim into its row
 * (`schema/container-rebuilders.rebuildTableRowRaw`) and the parser truncates a
 * row that reparses wider than the delimiter's column count, so one unescaped
 * `|` reaching a cell raw silently deletes the last column's content.
 *
 * The rule is the kind's (`normalizeRawWrite`) and runs at the write sink, so no
 * gesture carries it. Cut, Mod+B and Shift+Enter each carried an escape at the
 * call site and each lost it; a fourth carrier was then added above the sink and
 * a bare write past all three still corrupted the row. These pin the seam
 * instead of a directory: the kind declares, the sink applies, and the one write
 * that cannot reach the sink is named here rather than left to be rediscovered.
 *
 * The door rule below is the caret half, which no seam can absorb: the offset a
 * caller reports addresses the text it wrote, and the sink's inserted backslashes
 * move it, so cell writes must name the mapping wrapper.
 */

import { describe, it, expect } from 'vitest';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { collectEditorSources } from './scan-source';

const SINK = 'src/lib/tree-operations/node-ops.ts';
const CELL = 'src/lib/components/blocks/table/TableCellBlock.svelte';

/**
 * Every file naming the capability in code, and why. `updateNodeContent` is the
 * sink every gesture's text funnels through; find/replace is the one write that
 * cannot use it (it substitutes into a private clone and reparses), so it applies
 * the kind's rule itself. A new name here is a new write path that skipped the
 * sink — decide explicitly rather than inherit an escape by accident.
 */
const CAPABILITY_SITES: Record<string, string> = {
	'src/lib/schema/block-kind-descriptor.ts': 'the field declaration',
	'src/lib/schema/built-in-descriptors.ts': 'tableCell declares it',
	[SINK]: 'the write sink applies it',
	'src/lib/editor-actions/search-replace.ts': 'reparses a private clone; cannot reach the sink'
};

/** The rule itself has one implementation; a second is what let two escapes disagree. */
const RULE_HOME = 'src/lib/schema/table-cell-raw.ts';
const RULE_READERS: Record<string, string> = {
	[RULE_HOME]: 'the implementation',
	'src/lib/schema/built-in-descriptors.ts': 'the tableCell declaration',
	'src/lib/components/blocks/table/table-cell-paste.ts': 'escapedCellOffset, the caret image'
};

const CAPABILITY = /\bnormalizeRawWrite\b/;
// `?.` included: an optional-chained bundle write is the same write, and the
// receiver-name rule below is the only thing standing between it and a bare raw.
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

describe('the tableCell write rule lives on the kind and runs at the sink', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('tableCell declares the capability', () => {
		expect(typeof getBlockKindDescriptor('tableCell').normalizeRawWrite).toBe('function');
	});

	it('the sink applies whatever the kind declared', () => {
		const sink = sources.find((f) => f.relPath === SINK);
		expect(sink, `${SINK} not found`).toBeDefined();
		expect(CAPABILITY.test(sink!.code), `the sink stopped applying the capability`).toBe(true);
	});

	it('exactly the documented sites name the capability', () => {
		expect(namesInCode(sources, CAPABILITY)).toEqual(Object.keys(CAPABILITY_SITES).sort());
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

	// Repo-wide, not table-only: the receiver name is the rule, and a content write
	// grabbing an unwrapped bundle is the shape that lost the escape three times.
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
