/**
 * G2.10 sticky-column guards. Two rules, both source-scanned because neither
 * fits in a type.
 *
 * 1. Capture without reset. A surface that CAPTURES the editor-level sticky X —
 *    because it bypasses handleSharedKeydown with custom arrow handling — must
 *    also reset it, or the column leaks across unrelated edits. The only
 *    bypassing surface today is the table, where capture lives in TableBlock
 *    (exit-up/down) and reset lives in the sibling TableCellBlock (non-arrow
 *    keydown + focusout), so a naive "same file must reset" scan would
 *    false-positive. The allowlist names each capture site with where its reset
 *    lives; a new capture site trips the set check and forces an explicit reset
 *    decision.
 *
 * 2. The keydown door. `noteKey` owns what a key does to the column — capture,
 *    preserve, or reset. A keydown handler calling `reset()` directly is the
 *    N-1-of-N parity shape that let the cross-block dispatcher swallow the reset
 *    for every key it consumed: eight arms returned before the shared prelude's
 *    decision, and the collapse arms run no commit, so nothing downstream reset
 *    either. Exceptions are non-key call sites pinned by count. The same shape
 *    recurred at a seam this scan did not list, so the list is now the rule's
 *    subject and a new key-consuming surface joins it or the column leaks.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

// Sticky `.capture(` call on a StickyColumnState — `x.capture(`. Excludes the
// table's INTERNAL column (`internalStickyColumn` is a plain number index, a
// different concept) by matching only the editor-level handles in use.
const CAPTURE_RE = /\b(stickyColumn|editorStickyColumn)\.capture\s*\(/;
const RESET_RE = /\b(stickyColumn|editorStickyColumn)\.reset\s*\(/;
const RESET_RE_ALL = /\b(stickyColumn|editorStickyColumn)\.reset\s*\(/g;
const NOTE_KEY_RE = /\b(stickyColumn|editorStickyColumn)\.noteKey\s*\(/;

/** Each capture site → the file where its corresponding reset lives. */
const CAPTURE_SITES: Record<string, string> = {
	// Table exit-up/down captures the editor sticky X before leaving the table;
	// the sibling cell resets it on the next non-arrow keystroke / focusout.
	'src/lib/components/blocks/table/TableBlock.svelte':
		'src/lib/components/blocks/table/TableCellBlock.svelte'
};

/**
 * The keydown entry paths, each of which must route through the door. Listed
 * explicitly rather than derived from the path name: the whole-block key tail is
 * a classification entry path that no file-name pattern would find, and it
 * consumed all four arrows while leaving the column untouched — a caret that had
 * moved on kept landing at the column it left.
 */
const KEYDOWN_SEAM_FILES = [
	'src/lib/selection/shared-keydown.ts',
	'src/lib/selection/cross-block/keydown.ts',
	'src/lib/editor-actions/container-block-component.ts'
];

/** Direct `reset()` calls a keydown file may keep, with why and how many. */
const KEYDOWN_RESET_EXCEPTIONS: Record<string, { count: number; why: string }> = {
	'src/lib/selection/cross-block/keydown.ts': {
		count: 1,
		why: 'handleCompositionStart — an IME lifecycle event, with no key to classify'
	}
};

const isKeydownFile = (relPath: string) => /keydown/i.test(relPath);

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

describe('G2.10 keydown-door guard', () => {
	const sources = collectEditorSources();

	it('no keydown handler clears the column outside the classification door', () => {
		const offenders = sources
			.filter((f) => isKeydownFile(f.relPath))
			.map((f) => ({
				relPath: f.relPath,
				count: f.code.match(RESET_RE_ALL)?.length ?? 0
			}))
			.filter(({ relPath, count }) => count !== (KEYDOWN_RESET_EXCEPTIONS[relPath]?.count ?? 0))
			.map(({ relPath, count }) => `${relPath}: ${count} direct reset(s)`);
		expect(offenders).toEqual([]);
	});

	it('each keydown-reset exception still holds its documented call (no dead entry)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const [relPath, { count, why }] of Object.entries(KEYDOWN_RESET_EXCEPTIONS)) {
			const file = byPath.get(relPath);
			expect(file, `exception file not found: ${relPath}`).toBeDefined();
			expect(file!.code.match(RESET_RE_ALL)?.length ?? 0, `stale exception (${why})`).toBe(count);
		}
	});

	it('every keydown entry path routes through the door', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const relPath of KEYDOWN_SEAM_FILES) {
			const file = byPath.get(relPath);
			expect(file, `keydown seam file not found: ${relPath}`).toBeDefined();
			expect(NOTE_KEY_RE.test(file!.code), `no noteKey call in ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	// The matcher scopes the direct-reset rule only; the seam list above is its own
	// enumeration, so a seam whose path omits "keydown" is still held to the door.
	it('the reset-scan matcher selects the path-named seams and skips unrelated sources', () => {
		expect(isKeydownFile('src/lib/selection/shared-keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/pointer.ts')).toBe(false);
		expect(isKeydownFile('src/lib/components/Editor.svelte')).toBe(false);
	});
});
