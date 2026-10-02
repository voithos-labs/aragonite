// @vitest-environment jsdom
// `editor.canRunCommand` through a real mount, over the ids and the handle a host reads from the
// barrel. The cross-block answer is covered in `test/schema/command-admissibility.test.ts`,
// where a painted range needs no live selection.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TOOLBAR_COMMANDS, type EditorInstance } from '$lib';
import { registerBlockCommand } from '$lib/schema/block-commands';
import { takeDevWarns } from '../support/warn-gate';
import {
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(() => installLayoutStubs());

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
	document.body.innerHTML = '';
});

const SOURCE = 'alpha beta\n';
const TOOLBAR_IDS = Object.values(TOOLBAR_COMMANDS);

function editorWithSelection(props = {}): EditorInstance {
	mounted = mountEditor({ source: SOURCE, ...props });
	selectRange(surfaceAt(mounted, [0]), 0, 5);
	return mounted.instance;
}

describe('the admissibility read on the instance surface', () => {
	it('admits every published toolbar id at a live selection, and the entry point agrees', () => {
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

	// A host may ask on every selection change, so the read must not spend the one-time
	// "nothing handles this id" warning a real invocation produces.
	it('declines an unknown id without dev-warning', () => {
		const editor = editorWithSelection();
		expect(editor.canRunCommand('format.toggleRainbow')).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	// A block command is reachable by its chord only: the API resolves a block with no command
	// context, so a created plugin id is refused by both the read and the run.
	it('reaches no created plugin command, neither read nor run', () => {
		const minted = registerBlockCommand('paragraph', 'demo.doorOnly', () => true);
		const editor = editorWithSelection();

		expect(editor.canRunCommand(minted)).toBe(false);
		expect(editor.runCommand(minted)).toBe(false);
		// The run must produce the diagnostic the read holds back.
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});
});
