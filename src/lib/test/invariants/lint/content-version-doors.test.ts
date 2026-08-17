/**
 * The content version is announced, not derived, so a byte-writing door that stays silent serves
 * every whole-document memo a stale answer with nothing failing. Two arms: the announcements are
 * a declared set, and the shape an out-of-ceremony write has — unsharing a spine off the editor's
 * own `deps.doc` — enrolls its file, so door N+1 fails at birth rather than at the next audit.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** Every file naming the announcement, and the door it owns. */
const ANNOUNCERS: Record<string, string> = {
	'src/lib/editor-actions/deps.ts': 'the declaration',
	'src/lib/editor-actions/commit/undo-controller.ts':
		'the ceremony, covering both publish arms and every structural writer under them',
	'src/lib/editor-actions/block-edit.ts': 'the top-level routine-typing write',
	'src/lib/editor-actions/container-edit.ts': 'the nested out-of-ceremony write door',
	'src/lib/editor-actions/commit/history.ts': 'the undo/redo tree swap',
	'src/lib/components/Editor.svelte': 'the wiring, plus the `source` prop swap',
	'src/lib/testing/headless-actions.ts': 'the published harness counts what its doors announced'
};

/**
 * Unsharing off `deps.doc` is what an ACTION-layer byte write looks like: inside a commit the
 * spine is reached through the mutate's own scope view instead. Each is the ceremony or announces.
 */
const ROOT_UNSHARERS: Record<string, string> = {
	'src/lib/editor-actions/commit/undo-controller.ts': 'the ceremony itself',
	'src/lib/editor-actions/block-edit.ts': 'announces',
	'src/lib/editor-actions/container-edit.ts': 'announces'
};

const ANNOUNCES = /\bbumpContentVersion\b|\bcontentVersion\.bump\b/;
const UNSHARES_ROOT = /\bensureUnsharedPath\s*\(\s*deps\.doc\b/;

function matching(sources: SourceFile[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(stripComments(f.text)))
		.map((f) => f.relPath)
		.sort();
}

describe('content-version door census', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the declared files announce a byte write', () => {
		expect(
			matching(sources, ANNOUNCES),
			'an announcement was added or dropped: name the door it owns, or the memos over the document go stale'
		).toEqual(Object.keys(ANNOUNCERS).sort());
	});

	it('exactly the declared files unshare a spine off the editor’s own document', () => {
		expect(
			matching(sources, UNSHARES_ROOT),
			'a new out-of-ceremony write door: announce the bytes it moves, or route it through the commit ceremony'
		).toEqual(Object.keys(ROOT_UNSHARERS).sort());
	});

	it('every root unsharer is the ceremony or announces for itself', () => {
		const silent = Object.keys(ROOT_UNSHARERS).filter((relPath) => !(relPath in ANNOUNCERS));
		expect(silent).toEqual([]);
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

	it('an undeclared door fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/editor-actions/rogue.ts',
			text: 'ensureUnsharedPath(deps.doc, path, deps.sharing);',
			code: ''
		};
		expect(matching([...sources, rogue], UNSHARES_ROOT)).not.toEqual(
			Object.keys(ROOT_UNSHARERS).sort()
		);
	});
});
