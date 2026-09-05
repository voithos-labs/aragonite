// @vitest-environment jsdom
//
// `editor.runCommand` driven through a real mount, so the assertions are on committed bytes and
// the real undo stack rather than a stubbed action bundle: a toolbar button must land the same
// single entry the chord does.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TOOLBAR_COMMANDS } from '$lib/index';
import type { UndoEntry } from '$lib/undo/types';
import { allowDevWarns } from '../support/warn-gate';
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
});

const SOURCE = 'alpha beta\n';

function undoStack(): UndoEntry[] {
	return (
		mounted!.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack().undo;
}

/** Select `[start, end)` in the first block, the way a pointer drag over a word leaves it. */
function selectInFirstBlock(start: number, end: number): void {
	selectRange(surfaceAt(mounted!, [0]), start, end);
}

describe('the runCommand door over a selection', () => {
	it('a toggle writes the same bytes as the chord and lands ONE undo entry', async () => {
		mounted = mountEditor({ source: SOURCE });
		selectInFirstBlock(0, 5);

		expect(mounted.instance.runCommand(TOOLBAR_COMMANDS.toggleStrong)).toBe(true);
		await mounted.settle();

		expect(mounted.source()).toBe('**alpha** beta\n');
		expect(undoStack()).toHaveLength(1);
	});

	it('reading mode declines every published id, byte-unchanged', async () => {
		mounted = mountEditor({ source: SOURCE, presentationMode: 'reading' });
		selectInFirstBlock(0, 5);

		for (const id of Object.values(TOOLBAR_COMMANDS)) {
			expect(mounted.instance.runCommand(id)).toBe(false);
		}
		await mounted.settle();

		expect(mounted.source()).toBe(SOURCE);
		expect(undoStack()).toHaveLength(0);
	});

	it('an unknown id declines and mutates nothing', async () => {
		mounted = mountEditor({ source: SOURCE });
		selectInFirstBlock(0, 5);

		expect(mounted.instance.runCommand('format.toggleRainbow')).toBe(false);
		// The seam dev-warns an id no tier resolves; the decline, not the warn, is the subject.
		allowDevWarns(['commands']);
		await mounted.settle();

		expect(mounted.source()).toBe(SOURCE);
		expect(undoStack()).toHaveLength(0);
	});

	it('a block-local id declines with focus outside the editor; undo still reaches the seam', async () => {
		mounted = mountEditor({ source: SOURCE });
		selectInFirstBlock(0, 5);
		expect(mounted.instance.runCommand(TOOLBAR_COMMANDS.toggleStrong)).toBe(true);
		await mounted.settle();

		(document.activeElement as HTMLElement | null)?.blur();

		expect(mounted.instance.runCommand(TOOLBAR_COMMANDS.toggleStrong)).toBe(false);
		expect(mounted.instance.runCommand('history.undo')).toBe(true);
		await mounted.settle();

		expect(mounted.source()).toBe(SOURCE);
	});
});
