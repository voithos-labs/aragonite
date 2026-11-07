// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { crossBlockClipboardArm } from '#lib/selection/cross-block/clipboard.js';
import { runClipboardCut } from '#lib/components/blocks/editable/clipboard-step.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { parse } from '#lib/core/parser.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import type { SelectionState } from '#lib/selection/selection-state.svelte.js';

function makeDeps(selection: SelectionState, deleteSpy = vi.fn(async () => {})) {
	const doc = parse('hello\n\nworld\n');
	const crossBlock = {
		performCrossBlockCut: deleteSpy,
		reading: fixtureReading()
	} as unknown as CrossBlockHandlers;
	return { selection, getDoc: () => doc, crossBlock };
}

function makeCopyEvent(): { event: ClipboardEvent; written: Map<string, string> } {
	const written = new Map<string, string>();
	const event = {
		preventDefault: () => {},
		clipboardData: { setData: (type: string, value: string) => written.set(type, value) }
	} as unknown as ClipboardEvent;
	return { event, written };
}

function crossBlockSelection(): SelectionState {
	const selection = createSelectionState();
	selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
	return selection;
}

describe('the cross-block clipboard arm', () => {
	it('declines a selection inside one block, writing nothing', () => {
		const arm = crossBlockClipboardArm(makeDeps(createSelectionState()));

		// The null is what lets the block's own range take the copy next.
		expect(arm.copy()).toBeNull();
	});

	it('copies the collected text of a range across blocks', () => {
		const arm = crossBlockClipboardArm(makeDeps(crossBlockSelection()));

		expect(arm.copy()?.write.text).toContain('hello');
	});

	it('a cut outside a range across blocks deletes nothing', async () => {
		const deleteSpy = vi.fn(async () => {});
		const arm = crossBlockClipboardArm(makeDeps(createSelectionState(), deleteSpy));

		await runClipboardCut(makeCopyEvent().event, [arm]);
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('a cut writes the text before the range delete starts', async () => {
		const { event, written } = makeCopyEvent();
		const deleteSpy = vi.fn(async () => {
			expect(written.get('text/plain')).toContain('hello');
		});
		const arm = crossBlockClipboardArm(makeDeps(crossBlockSelection(), deleteSpy));

		const cut = runClipboardCut(event, [arm]);
		expect(written.get('text/plain')).toContain('hello');
		await cut;
		expect(deleteSpy).toHaveBeenCalledOnce();
	});
});
