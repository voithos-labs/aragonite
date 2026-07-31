// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { asEditorX } from '../../../cursor/coordinate-spaces';
import { createStickyColumnState } from '../../../cursor/sticky-column';
import { createSelectionState } from '../../../selection/selection-state.svelte';
import { createCrossBlockKeydown } from '../../../selection/cross-block/keydown';
import type { CrossBlockDispatchContext } from '../../../selection/cross-block/dispatch';
import type { CrossBlockMutationContext } from '../../../selection/cross-block/ops';

// B8-2: every key the cross-block dispatcher consumes returned before handleSharedKeydown reached
// its sticky decision, and the collapse arms run no commit — so nothing downstream reset either.
// Driven at the dispatcher because that is the entry path that swallows the key.
function harness() {
	const doc = parse('alpha beta gamma\n\ndelta\n');
	const selection = createSelectionState({ getDoc: () => doc });
	const stickyColumn = createStickyColumnState();

	const ctx = {
		getEl: () => document.createElement('div'),
		getMyPath: () => [0],
		selection,
		stickyColumn,
		getDoc: () => doc,
		getBlockElByPath: () => document.createElement('div'),
		revealPath: async () => null,
		getPresentationMode: undefined,
		afterReactivity: async () => {}
	} as unknown as CrossBlockDispatchContext;

	const keydown = createCrossBlockKeydown(ctx, {} as unknown as CrossBlockMutationContext);
	return { selection, stickyColumn, keydown };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

describe('cross-block keydown — sticky column', () => {
	it('resets the column on a key it consumes to collapse the selection', async () => {
		const { selection, stickyColumn, keydown } = harness();
		selection.enterCrossBlock({ path: [0], offset: 16 }, { path: [1], offset: 0 });
		stickyColumn.capture(asEditorX(600));

		expect(await keydown.handleKeyDown(press('ArrowLeft'))).toBe(true);

		expect(stickyColumn.get()).toBeNull();
	});

	it('resets on Escape, which also collapses without a commit behind it', async () => {
		const { selection, stickyColumn, keydown } = harness();
		selection.enterCrossBlock({ path: [0], offset: 16 }, { path: [1], offset: 0 });
		stickyColumn.capture(asEditorX(600));

		expect(await keydown.handleKeyDown(press('Escape'))).toBe(true);

		expect(stickyColumn.get()).toBeNull();
	});

	it('preserves the column on a vertical arrow — the dispatcher has no caret to measure', async () => {
		const { selection, stickyColumn, keydown } = harness();
		selection.enterCrossBlock({ path: [0], offset: 16 }, { path: [1], offset: 0 });
		stickyColumn.capture(asEditorX(600));

		await keydown.handleKeyDown(press('ArrowDown'));

		expect(stickyColumn.get()).toBe(600);
	});

	it('preserves the column for a bare modifier the dispatcher does not consume', async () => {
		const { stickyColumn, keydown } = harness();
		stickyColumn.capture(asEditorX(600));

		expect(await keydown.handleKeyDown(press('Shift'))).toBe(false);

		expect(stickyColumn.get()).toBe(600);
	});
});
