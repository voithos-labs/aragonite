/**
 * G2.10's keydown rule, checked by scanning the source because it does not fit in a type: every
 * keydown path tells the caret memory about the key through `noteKey`, which decides what the key
 * does to the column, the side and the marks. A handler calling `forget()` instead is the shape
 * that let the cross-block dispatcher drop the column on keys it consumed.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const FORGET_RE_ALL = /\bcaretMemory\.forget\s*\(/g;
const NOTE_KEY_RE = /\bcaretMemory\.noteKey\s*\(/;

/**
 * The keydown entry paths, each of which has to go through `noteKey`. Listed explicitly rather
 * than derived from the file name, which misses entry paths like the whole-block key tail, where
 * four arrows were consumed with the column left untouched.
 */
const KEYDOWN_ENTRY_FILES = [
	'src/lib/selection/shared-keydown.ts',
	'src/lib/selection/cross-block/keydown.ts',
	'src/lib/editor-actions/container-block-component.ts',
	'src/lib/editor-actions/plugin/container.ts'
];

/** Direct `forget()` calls a keydown file may keep, with why and how many. */
const KEYDOWN_FORGET_EXCEPTIONS: Record<string, { count: number; why: string }> = {
	'src/lib/selection/cross-block/keydown.ts': {
		count: 1,
		why: 'handleCompositionStart: an IME lifecycle event, with no key to classify'
	}
};

const isKeydownFile = (relPath: string) => /keydown/i.test(relPath);

/**
 * Every file the file-name scan picks up. The scan catches a dispatcher nobody added to
 * `KEYDOWN_ENTRY_FILES`, but it also picks up files holding no caret memory, which pass its
 * zero-forget check trivially. Pinning the set exactly turns a new keydown-named file into a
 * decision: dispatcher, router, or pure transform.
 */
const KEYDOWN_PATH_NAMED_FILES: Record<string, string> = {
	'src/lib/selection/shared-keydown.ts': 'dispatcher: classifies through noteKey',
	'src/lib/selection/cross-block/keydown.ts': 'dispatcher: classifies through noteKey',
	'src/lib/components/editor-root-keydown.ts':
		'router: chord arms (search, Escape, editor-global) move no caret; the one arm that does delegates to the cross-block dispatcher, which notes the key',
	'src/lib/components/blocks/text/text-keydown.ts':
		'pure raw transforms (hard break, heading cycle, literal tab); returns bytes, touches no caret memory',
	'src/lib/components/blocks/table/cell-keydown-plan.ts':
		'pure key→plan classifier; the plan’s executor owns the caret, not this module'
};

describe('G2.10 keydown entry-point guard', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no keydown handler forgets the caret memory instead of classifying the key', () => {
		const offenders = sources
			.filter((f) => isKeydownFile(f.relPath))
			.map((f) => ({
				relPath: f.relPath,
				count: f.code.match(FORGET_RE_ALL)?.length ?? 0
			}))
			.filter(({ relPath, count }) => count !== (KEYDOWN_FORGET_EXCEPTIONS[relPath]?.count ?? 0))
			.map(({ relPath, count }) => `${relPath}: ${count} direct forget(s)`);
		expect(offenders).toEqual([]);
	});

	it('each keydown-forget exception still holds its documented call (no dead entry)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const [relPath, { count, why }] of Object.entries(KEYDOWN_FORGET_EXCEPTIONS)) {
			const file = byPath.get(relPath);
			expect(file, `exception file not found: ${relPath}`).toBeDefined();
			expect(file!.code.match(FORGET_RE_ALL)?.length ?? 0, `stale exception (${why})`).toBe(count);
		}
	});

	it('every keydown entry path notes the key', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const relPath of KEYDOWN_ENTRY_FILES) {
			const file = byPath.get(relPath);
			expect(file, `keydown entry file not found: ${relPath}`).toBeDefined();
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
			'a keydown-named file joined the tree: add it to KEYDOWN_ENTRY_FILES if it dispatches keys, ' +
				'or to KEYDOWN_PATH_NAMED_FILES saying why it holds no caret memory'
		).toEqual(Object.keys(KEYDOWN_PATH_NAMED_FILES).sort());
	});

	it('every path-named dispatcher is also on the entry list', () => {
		const dispatchers = Object.entries(KEYDOWN_PATH_NAMED_FILES)
			.filter(([, role]) => role.startsWith('dispatcher'))
			.map(([relPath]) => relPath);
		for (const relPath of dispatchers) {
			expect(KEYDOWN_ENTRY_FILES, `${relPath} is a dispatcher but not listed`).toContain(relPath);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	// The file-name matcher covers the direct-forget rule only: the list of entry paths is its own,
	// so one whose file name omits "keydown" is still held to `noteKey`.
	it('the forget-scan matcher selects the path-named modules and skips unrelated sources', () => {
		expect(isKeydownFile('src/lib/selection/shared-keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/keydown.ts')).toBe(true);
		expect(isKeydownFile('src/lib/selection/cross-block/pointer.ts')).toBe(false);
		expect(isKeydownFile('src/lib/components/Editor.svelte')).toBe(false);
	});

	it('the call matchers read the memory handle and skip its other members', () => {
		expect('ctx.caretMemory.forget();'.match(FORGET_RE_ALL)).toHaveLength(1);
		expect(NOTE_KEY_RE.test('deps.caretMemory.noteKey(e, deps.commandOf(e));')).toBe(true);
		expect('caretMemory.noteExtreme();'.match(FORGET_RE_ALL)).toBeNull();
		expect(NOTE_KEY_RE.test('caretMemory.noteTyping();')).toBe(false);
	});
});
