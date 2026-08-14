// @vitest-environment jsdom
//
// `editor.canRunCommand` through a real mount, over the ids and the handle a host reads from the
// barrel. The cross-block half of the verdict is pinned at the seam both paths meet
// (`test/schema/command-admissibility.test.ts`), where a painted range needs no live selection.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TOOLBAR_COMMANDS, type EditorInstance } from '$lib';
import { registerBlockCommand, __resetBlockCommandsForTests } from '$lib/schema/block-commands';
import { takeDevWarns } from '../support/warn-gate';
import {
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from './editor-mount';

beforeAll(() => installLayoutStubs());

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
	document.body.innerHTML = '';
	__resetBlockCommandsForTests();
});

const SOURCE = 'alpha beta\n';
const TOOLBAR_IDS = Object.values(TOOLBAR_COMMANDS);

function editorWithSelection(props = {}): EditorInstance {
	mounted = mountEditor({ source: SOURCE, ...props });
	selectRange(surfaceAt(mounted, [0]), 0, 5);
	return mounted.instance;
}

describe('the admissibility read on the instance surface', () => {
	it('admits every published toolbar id at a live selection, and the door agrees', () => {
		const editor = editorWithSelection();
		for (const id of TOOLBAR_IDS) expect(editor.canRunCommand(id), id).toBe(true);
		expect(editor.runCommand(TOOLBAR_COMMANDS.toggleStrong)).toBe(true);
	});

	it('declines the block-local half with focus outside, undo still admitted', () => {
		const editor = editorWithSelection();
		(document.activeElement as HTMLElement | null)?.blur();

		for (const id of TOOLBAR_IDS) expect(editor.canRunCommand(id), id).toBe(false);
		expect(editor.canRunCommand('history.undo')).toBe(true);
	});

	it('declines the whole vocabulary in reading mode', () => {
		const editor = editorWithSelection({ presentationMode: 'reading' });
		for (const id of TOOLBAR_IDS) expect(editor.canRunCommand(id), id).toBe(false);
		expect(editor.canRunCommand('history.undo')).toBe(false);
	});

	// A host may ask on every selection change, so the probe must not spend the one-time dead-key
	// diagnostic the dispatch owes a real invocation.
	it('declines an unknown id without dev-warning', () => {
		const editor = editorWithSelection();
		expect(editor.canRunCommand('format.toggleRainbow')).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	// The chord-only boundary, held by the real focused target rather than by prose: the door
	// resolves a surface with no command context, so a minted id reaches neither tier. Both halves
	// spend one walk now, so this is what keeps the contract from moving under the read.
	it('reaches no minted plugin command, neither read nor run', () => {
		const minted = registerBlockCommand('paragraph', 'demo.doorOnly', () => true);
		const editor = editorWithSelection();

		expect(editor.canRunCommand(minted)).toBe(false);
		expect(editor.runCommand(minted)).toBe(false);
		// The run owes the diagnostic the read withholds.
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});
});
