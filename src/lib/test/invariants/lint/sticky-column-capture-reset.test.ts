/**
 * G2.10 capture-without-reset guard. The sticky-column two-axis contract
 * (cursor/sticky-column.ts header): a surface that CAPTURES the editor-level
 * sticky X — because it bypasses handleSharedKeydown with custom arrow handling
 * — must also reset it, or the column leaks across unrelated edits.
 *
 * handleSharedKeydown captures and resets in one place, so blocks routing
 * keydown through it are covered for free. The only bypassing surface today is
 * the table, where capture lives in TableBlock (exit-up/down) and reset lives
 * in the sibling TableCellBlock (non-arrow keydown + focusout) — so a naive
 * "same file must reset" scan would false-positive. The allowlist names each
 * capture site with where its reset lives; a new capture site trips the set
 * check and forces an explicit reset decision.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

// Sticky `.capture(` call on a StickyColumnState — `x.capture(`. Excludes the
// table's INTERNAL column (`internalStickyColumn` is a plain number index, a
// different concept) by matching only the editor-level handles in use.
const CAPTURE_RE = /\b(stickyColumn|editorStickyColumn)\.capture\s*\(/;
const RESET_RE = /\b(stickyColumn|editorStickyColumn)\.reset\s*\(/;

/** Each capture site → the file where its corresponding reset lives. */
const CAPTURE_SITES: Record<string, string> = {
	// Shared keydown prelude captures on vertical arrows and resets on every
	// non-preserve key, both in this file — the sanctioned path.
	'src/lib/editor/selection/shared-keydown.ts': 'src/lib/editor/selection/shared-keydown.ts',
	// Table exit-up/down captures the editor sticky X before leaving the table;
	// the sibling cell resets it on the next non-arrow keystroke / focusout.
	'src/lib/editor/components/blocks/table/TableBlock.svelte':
		'src/lib/editor/components/blocks/table/TableCellBlock.svelte'
};

describe('G2.10 capture-without-reset guard', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every sticky-capture site is allowlisted with a documented reset location', () => {
		const captureSites = sources
			.filter((f) => CAPTURE_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(captureSites).toEqual(Object.keys(CAPTURE_SITES).sort());
	});

	it('each allowlisted capture site still captures (no dead entry)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const relPath of Object.keys(CAPTURE_SITES)) {
			const file = byPath.get(relPath);
			expect(file, `capture site not found: ${relPath}`).toBeDefined();
			expect(CAPTURE_RE.test(file!.code), `capture stale for ${relPath}`).toBe(true);
		}
	});

	it('each capture site’s documented reset file actually resets', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const [captureFile, resetFile] of Object.entries(CAPTURE_SITES)) {
			const file = byPath.get(resetFile);
			expect(file, `reset file not found: ${resetFile} (for ${captureFile})`).toBeDefined();
			expect(RESET_RE.test(file!.code), `no sticky reset in ${resetFile}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('capture matcher flags both editor-level handles', () => {
		expect(CAPTURE_RE.test('ctx.stickyColumn.capture(x)')).toBe(true);
		expect(CAPTURE_RE.test('editorStickyColumn.capture(stickyX)')).toBe(true);
	});

	it('capture matcher ignores the table’s internal numeric column', () => {
		expect(CAPTURE_RE.test('internalStickyColumn = colIdx;')).toBe(false);
		expect(CAPTURE_RE.test('ctx.setStickyColumn(colIdx)')).toBe(false);
	});
});
