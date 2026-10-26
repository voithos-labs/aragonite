/**
 * The content version is announced, not derived, so a function that writes bytes without
 * announcing serves every whole-document memo a stale answer. Every announcing file is declared,
 * so is every byte write outside a commit (it copies ancestors off `deps.doc`), and each such
 * writer checks for reading mode.
 */

import { describe, it, expect } from 'vitest';
import {
	callSites,
	collectEditorSources,
	enclosingFunction,
	fileClasses,
	sourceFile,
	type SourceFile
} from './scan-source';
import { describeManifests } from './file-rule';

/** Every file naming the announcement, and the write it owns. */
const ANNOUNCERS: Record<string, string> = {
	'src/lib/editor-actions/deps.ts': 'the declaration',
	'src/lib/editor-actions/commit/commit-frame.ts':
		'the commit frame, under every structural commit and every keystroke written in place',
	'src/lib/editor-actions/commit/history.ts': 'the undo/redo tree swap',
	'src/lib/components/Editor.svelte': 'the wiring',
	'src/lib/components/editor-root/document-swap.ts': 'the `source` prop swap',
	'src/lib/testing/headless-actions.ts': 'the published harness counts what its doors announced'
};

/** A byte write outside a commit copies ancestors off `deps.doc` (a commit reaches them through its
 *  own view); each such file is the commit itself or announces the new version. */
const ROOT_UNSHARERS: Record<string, string> = {
	'src/lib/editor-actions/commit/structural-commit.ts':
		'the commit’s own copy of each block list’s chain',
	'src/lib/editor-actions/commit/leaf-commit.ts': 'the keystroke’s copy of the leaf’s chain'
};

/** Root unsharers that write only inside the mutate `__commit` runs, which announces and asks the
 *  reading-mode check for them. */
const INSIDE_THE_COMMIT: Record<string, string> = {
	'src/lib/editor-actions/commit/structural-commit.ts':
		'copies each block list’s chain in the mutate the commit frame runs',
	'src/lib/editor-actions/commit/leaf-commit.ts':
		'copies the leaf’s chain in the step the commit frame runs after its reading-mode check'
};

type ReadingCheck = 'admitsWrite' | 'admitsSnapshot' | 'admitsHistoryRequest';

/** Writers that must refuse reading mode, and the functions in each that must ask the check. The
 *  `source` prop swap is absent: reading mode allows the host to replace the document. */
const READING_CHECKED: Record<string, Partial<Record<ReadingCheck, string[]>>> = {
	'src/lib/editor-actions/commit/commit-frame.ts': { admitsWrite: ['runFrame'] },
	'src/lib/editor-actions/commit/undo-controller.ts': {
		admitsSnapshot: ['pushCommitSnapshot', 'typingKeystroke']
	},
	'src/lib/editor-actions/commit/history.ts': {
		admitsHistoryRequest: ['requestUndo', 'requestRedo']
	}
};

/** `check:function` for each named function in `file` that never calls its check. */
function missingReadingChecks(file: SourceFile, spec: Partial<Record<ReadingCheck, string[]>>) {
	const { code } = file;
	const classes = fileClasses(file);
	return Object.entries(spec).flatMap(([check, functions]) => {
		const sites = callSites(code, check);
		const asking = new Set(sites.map((s) => enclosingFunction(code, s.index, classes)));
		return (functions ?? []).filter((fn) => !asking.has(fn)).map((fn) => `${check}:${fn}`);
	});
}

const ANNOUNCES = /\bbumpContentVersion\b|\bcontentVersion\.bump\b/;
const UNSHARES_ROOT = /\bensureUnsharedPath\s*\(\s*deps\.doc\b/;

const sources = collectEditorSources();

describeManifests(
	[
		{
			id: 'exactly the declared files announce a byte write',
			matches: ANNOUNCES,
			declared: ANNOUNCERS,
			reason:
				'an announcement was added or dropped: name the entry point it owns, or the memos over the document go stale',
			hits: ['deps.bumpContentVersion();', 'contentVersion.bump();'],
			misses: ['// bumpContentVersion would announce it']
		},
		{
			id: 'exactly the declared files unshare an ancestor chain off the editor’s own document',
			matches: UNSHARES_ROOT,
			declared: ROOT_UNSHARERS,
			reason:
				'a new write entry point outside the commit sequence: announce the bytes it moves, or route it through that sequence',
			hits: ['ensureUnsharedPath(deps.doc, [i], deps.sharing);'],
			misses: [
				'ensureUnsharedPath({ children }, [i], view.sharing);',
				'// ensureUnsharedPath(deps.doc, path, sharing) is the door'
			]
		}
	],
	sources
);

describe('content-version entry points that write outside a commit', () => {
	it('every root unsharer is the commit sequence or announces for itself', () => {
		const silent = Object.keys(ROOT_UNSHARERS).filter(
			(relPath) => !(relPath in ANNOUNCERS) && !(relPath in INSIDE_THE_COMMIT)
		);
		expect(silent).toEqual([]);
	});

	it('every root unsharer names the functions that must ask the reading-mode check', () => {
		const unnamed = Object.keys(ROOT_UNSHARERS).filter(
			(relPath) => !(relPath in READING_CHECKED) && !(relPath in INSIDE_THE_COMMIT)
		);
		expect(unnamed).toEqual([]);
	});

	it('each of those functions asks the reading-mode check itself', () => {
		const fileAt = new Map(sources.map((f) => [f.relPath, f]));
		const missing = Object.entries(READING_CHECKED).flatMap(([relPath, spec]) =>
			missingReadingChecks(fileAt.get(relPath) ?? sourceFile(relPath, ''), spec).map(
				(m) => `${relPath} ${m}`
			)
		);
		expect(
			missing,
			'a byte writer that skips `admitsWrite`, or an undo push that skips `admitsSnapshot`, writes in reading mode'
		).toEqual([]);
	});

	it('the per-function check sees a sibling that asks while the named one does not', () => {
		const file = sourceFile(
			'x.ts',
			'function requestUndo() { swap(); }\nfunction requestRedo() { if (!admitsWrite(r, "redo")) return; }'
		);
		expect(missingReadingChecks(file, { admitsWrite: ['requestUndo', 'requestRedo'] })).toEqual([
			'admitsWrite:requestUndo'
		]);
	});
});
