/**
 * G2.10 sticky-column guards, source-scanned because neither rule fits in a type. Capture
 * without reset leaks the column across unrelated edits, and a capture site's reset may
 * live in a sibling file, so the allowlist pairs them. `noteKey` owns what a key does to
 * the column, so a handler calling `reset()` directly is the N-1-of-N parity shape that
 * let the cross-block dispatcher swallow the reset for every key it consumed.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

// Matches only the editor-level handles, excluding the table's INTERNAL column — a plain
// number index, a different concept.
const CAPTURE_RE = /\b(stickyColumn|editorStickyColumn)\.capture\s*\(/;
const RESET_RE = /\b(stickyColumn|editorStickyColumn)\.reset\s*\(/;
const RESET_RE_ALL = /\b(stickyColumn|editorStickyColumn)\.reset\s*\(/g;
const NOTE_KEY_RE = /\b(stickyColumn|editorStickyColumn)\.noteKey\s*\(/;

/** Each capture site → the file where its corresponding reset lives. */
const CAPTURE_SITES: Record<string, string> = {
	// The capture happens on the way out of the table; the sibling cell owns the reset.
	'src/lib/components/blocks/table/TableBlock.svelte':
		'src/lib/components/blocks/table/TableCellBlock.svelte'
};

/**
 * The keydown entry paths, each of which must route through the door. Listed explicitly
 * rather than derived from the path name, which misses classification entry paths like
 * the whole-block key tail — four arrows consumed with the column left untouched.
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

/**
 * Every file the path-name scan sweeps in. The scan is a net for a dispatcher nobody
 * added to `KEYDOWN_SEAM_FILES`, but it also collects files holding no column state,
 * which pass its zero-reset check trivially. Pinning the set exact turns a new
 * keydown-named file into a decision — dispatcher, router, or pure transform.
 */
const KEYDOWN_PATH_NAMED_FILES: Record<string, string> = {
	'src/lib/selection/shared-keydown.ts': 'dispatcher — classifies through noteKey',
	'src/lib/selection/cross-block/keydown.ts': 'dispatcher — classifies through noteKey',
	'src/lib/components/editor-root-keydown.ts':
		'router — chord arms (search, Escape, editor-global) move no caret; the one arm that does delegates to the cross-block dispatcher, which owns the door',
	'src/lib/components/blocks/text/text-keydown.ts':
		'pure raw transforms (hard break, heading cycle, literal tab); returns bytes, touches no column',
	'src/lib/components/blocks/table/cell-keydown-plan.ts':
		'pure key→plan classifier; the plan’s executor owns the column, not this module'
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

	it('the path-name scan sweeps in exactly the files accounted for', () => {
		const swept = sources
			.filter((f) => isKeydownFile(f.relPath))
			.map((f) => f.relPath)
			.sort();
		expect(
			swept,
			'a keydown-named file joined the tree: add it to KEYDOWN_SEAM_FILES if it dispatches keys, ' +
				'or to KEYDOWN_PATH_NAMED_FILES saying why it holds no column state'
		).toEqual(Object.keys(KEYDOWN_PATH_NAMED_FILES).sort());
	});

	it('every path-named dispatcher is also on the seam list', () => {
		const dispatchers = Object.entries(KEYDOWN_PATH_NAMED_FILES)
			.filter(([, role]) => role.startsWith('dispatcher'))
			.map(([relPath]) => relPath);
		for (const relPath of dispatchers) {
			expect(KEYDOWN_SEAM_FILES, `${relPath} is a dispatcher but not a seam`).toContain(relPath);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	// The matcher scopes the direct-reset rule only: the seam list is its own enumeration,
	// so a seam whose path omits "keydown" is still held to the door.
	it('the reset-scan matcher selects the path-named seams and skips unrelated sources', () => {
		expect(isKeydownFile('src/lib/selection/shared-keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/pointer.ts')).toBe(false);
		expect(isKeydownFile('src/lib/components/Editor.svelte')).toBe(false);
	});
});
