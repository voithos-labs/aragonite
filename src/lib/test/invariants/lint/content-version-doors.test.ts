/**
 * The content version is announced, not derived, so a function that writes bytes and stays silent
 * serves every whole-document memo a stale answer with nothing failing. The announcements are a
 * declared set, and any write outside a commit, recognized by its copying of ancestors off the
 * editor's own `deps.doc`, enrols its file; each such writer also asks the reading-mode check.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';
import { probeFile } from './file-rule';

/** Every file naming the announcement, and the write it owns. */
const ANNOUNCERS: Record<string, string> = {
	'src/lib/editor-actions/deps.ts': 'the declaration',
	'src/lib/editor-actions/commit/undo-controller.ts':
		'the ceremony, covering both publish arms and every structural writer under them',
	'src/lib/editor-actions/block-edit.ts': 'the top-level routine-typing write',
	'src/lib/editor-actions/container-edit.ts': 'the nested out-of-ceremony write door',
	'src/lib/editor-actions/commit/history.ts': 'the undo/redo tree swap',
	'src/lib/components/Editor.svelte': 'the wiring',
	'src/lib/components/editor-root-document-swap.ts': 'the `source` prop swap',
	'src/lib/testing/headless-actions.ts': 'the published harness counts what its doors announced'
};

/**
 * Copying ancestors off `deps.doc` is what a byte write in the action layer looks like: inside a
 * commit the ancestors are reached through the mutate's own view instead. Each entry is either
 * the commit itself or announces the new version.
 */
const ROOT_UNSHARERS: Record<string, string> = {
	'src/lib/editor-actions/commit/undo-controller.ts': 'the ceremony itself',
	'src/lib/editor-actions/block-edit.ts': 'announces',
	'src/lib/editor-actions/container-edit.ts': 'announces'
};

/** The writers that must refuse reading mode: every root unsharer, plus the undo/redo swap. The
 *  `source` prop swap is the host replacing the document, which reading mode allows. */
const READING_CHECKED = [
	...Object.keys(ROOT_UNSHARERS),
	'src/lib/editor-actions/commit/history.ts'
].sort();

const ANNOUNCES = /\bbumpContentVersion\b|\bcontentVersion\.bump\b/;
const ASKS_READING_CHECK = /\badmitsWrite\s*\(/;
const UNSHARES_ROOT = /\bensureUnsharedPath\s*\(\s*deps\.doc\b/;

function matching(sources: SourceFile[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('content-version entry-point census', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the declared files announce a byte write', () => {
		expect(
			matching(sources, ANNOUNCES),
			'an announcement was added or dropped: name the entry point it owns, or the memos over the document go stale'
		).toEqual(Object.keys(ANNOUNCERS).sort());
	});

	it('exactly the declared files unshare an ancestor chain off the editor’s own document', () => {
		expect(
			matching(sources, UNSHARES_ROOT),
			'a new write entry point outside the commit sequence: announce the bytes it moves, or route it through that sequence'
		).toEqual(Object.keys(ROOT_UNSHARERS).sort());
	});

	it('every root unsharer is the commit sequence or announces for itself', () => {
		const silent = Object.keys(ROOT_UNSHARERS).filter((relPath) => !(relPath in ANNOUNCERS));
		expect(silent).toEqual([]);
	});

	it('every writer that must refuse reading mode asks the reading-mode check', () => {
		const asking = matching(sources, ASKS_READING_CHECK);
		expect(
			READING_CHECKED.filter((relPath) => !asking.includes(relPath)),
			'a byte writer that never asks `admitsWrite` (editor-actions/commit/reading-write-gate.ts) writes in reading mode'
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the announcement matcher sees both spellings and skips prose', () => {
		const probe = (text: string) => ANNOUNCES.test(stripComments(text));
		expect(probe('deps.bumpContentVersion();')).toBe(true);
		expect(probe('contentVersion.bump();')).toBe(true);
		expect(probe('// bumpContentVersion would announce it')).toBe(false);
	});

	it('the root-unshare matcher skips a scope-view unshare and a comment', () => {
		const probe = (text: string) => UNSHARES_ROOT.test(stripComments(text));
		expect(probe('ensureUnsharedPath(deps.doc, [i], deps.sharing);')).toBe(true);
		expect(probe('ensureUnsharedPath({ children }, [i], view.sharing);')).toBe(false);
		expect(probe('// ensureUnsharedPath(deps.doc, path, sharing) is the door')).toBe(false);
	});

	it('an undeclared entry point fails the set equality', () => {
		const rogue = probeFile({
			relPath: 'src/lib/editor-actions/rogue.ts',
			code: 'ensureUnsharedPath(deps.doc, path, deps.sharing);'
		});
		expect(matching([...sources, rogue], UNSHARES_ROOT)).not.toEqual(
			Object.keys(ROOT_UNSHARERS).sort()
		);
	});
});
