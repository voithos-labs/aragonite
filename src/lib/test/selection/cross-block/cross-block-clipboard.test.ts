// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { writeCrossBlockCopy, writeCrossBlockCut } from '$lib/selection/cross-block/clipboard';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { parse } from '$lib/core/parser';
import type { CrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import type { SelectionState } from '$lib/selection/selection-state.svelte';

function makeDeps(selection: SelectionState, deleteSpy = vi.fn(async () => {})) {
	const doc = parse('hello\n\nworld\n');
	const crossBlock = {
		performCrossBlockDeleteFromEvent: deleteSpy
	} as unknown as CrossBlockHandlers;
	return { selection, getDoc: () => doc, crossBlock };
}

function makeCopyEvent(): {
	event: ClipboardEvent;
	written: Map<string, string>;
	preventSpy: ReturnType<typeof vi.fn>;
} {
	const written = new Map<string, string>();
	const preventSpy = vi.fn();
	const event = {
		preventDefault: preventSpy,
		clipboardData: { setData: (type: string, value: string) => written.set(type, value) }
	} as unknown as ClipboardEvent;
	return { event, written, preventSpy };
}

describe('cross-block clipboard prologue', () => {
	it('copy is a no-op fall-through when the selection is not cross-block', () => {
		const deps = makeDeps(createSelectionState());
		const { event, written, preventSpy } = makeCopyEvent();

		// The false return is what keeps each surface's native/intra-block path alive —
		// e.g. a plain single-cell table copy must NOT preventDefault.
		expect(writeCrossBlockCopy(event, deps)).toBe(false);
		expect(preventSpy).not.toHaveBeenCalled();
		expect(written.size).toBe(0);
	});

	it('copy claims the event and writes collected text when cross-block', () => {
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		const deps = makeDeps(selection);
		const { event, written, preventSpy } = makeCopyEvent();

		expect(writeCrossBlockCopy(event, deps)).toBe(true);
		expect(preventSpy).toHaveBeenCalledOnce();
		expect(written.get('text/plain')).toContain('hello');
	});

	it('cut does not trigger the range delete when the selection is not cross-block', async () => {
		const deleteSpy = vi.fn(async () => {});
		const deps = makeDeps(createSelectionState(), deleteSpy);
		const { event } = makeCopyEvent();

		expect(await writeCrossBlockCut(event, deps)).toBe(false);
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('cut writes text then performs the cross-block delete when cross-block', async () => {
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		const deleteSpy = vi.fn(async () => {});
		const deps = makeDeps(selection, deleteSpy);
		const { event, written } = makeCopyEvent();

		expect(await writeCrossBlockCut(event, deps)).toBe(true);
		expect(written.get('text/plain')).toContain('hello');
		expect(deleteSpy).toHaveBeenCalledOnce();
	});
});
