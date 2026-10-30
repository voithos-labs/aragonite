// @vitest-environment jsdom
// Miss-analysis: the e2e rows press only plain arrows on Windows and Linux engines, so nothing
// showed a macOS Option or Cmd arrow over a selection keeps its own motion.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleSharedKeydown, type SharedKeydownContext } from '#lib/selection/shared-keydown.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import type { FocusActions } from '#lib/action-contracts.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { makeCaretMemory } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { commandContext } from '#lib/test/harness/command-context.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

// jsdom lays nothing out, so the block reads as one line and every vertical arrow is at its edge.
vi.mock('../../browser/visual-lines', async (original) => ({
	...(await original<typeof import('../../browser/visual-lines')>()),
	isAtFirstVisualLine: () => true,
	isAtLastVisualLine: () => true
}));

function mount() {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = 'abcdef';
	document.body.appendChild(el);
	const text = el.firstChild as Text;
	const ctx: SharedKeydownContext = {
		caretWriter: testCaretWriter,
		caretLanding: { restore: async () => 'applied' as const, showSelectionEnd: async () => {} },
		commands: commandContext(),
		reading: fixtureReading(),
		scroll: { visibleBand: () => null, showRect: () => {} },
		getEl: () => el,
		getCursorOffset: () => {
			const sel = window.getSelection()!;
			return Math.min(sel.anchorOffset, sel.focusOffset);
		},
		getFocusOffset: () => window.getSelection()!.focusOffset,
		getTextLen: () => 6,
		getMyPath: () => [1],
		getIndex: () => 1,
		crossBlock: { handleKeyDown: async () => false } as unknown as CrossBlockHandlers,
		selection: createSelectionState(),
		caretMemory: makeCaretMemory(),
		history: {} as SharedKeydownContext['history'],
		focus: { moveFocus: vi.fn(async () => {}) } as unknown as FocusActions,
		getDoc: () => ({ kind: 'document', children: [] }) as never,
		unitContext: () => null,
		caretUnits: { beside: () => null, crossed: () => {} }
	};
	const select = (anchor: number, focus: number) =>
		window.getSelection()!.setBaseAndExtent(text, anchor, text, focus);
	const read = () => {
		const sel = window.getSelection()!;
		return { anchor: sel.anchorOffset, focus: sel.focusOffset };
	};
	return { ctx, select, read };
}

const press = (key: string, over: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key, cancelable: true, ...over });

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('handleSharedKeydown: a plain arrow over a range collapses it first', () => {
	for (const { key, anchor, focus, at } of [
		{ key: 'ArrowLeft', anchor: 4, focus: 1, at: 1 },
		{ key: 'ArrowRight', anchor: 4, focus: 1, at: 4 },
		{ key: 'ArrowUp', anchor: 1, focus: 4, at: 4 },
		{ key: 'ArrowDown', anchor: 4, focus: 1, at: 1 }
	]) {
		it(`${key} over ${anchor}..${focus} leaves a caret at ${at}`, async () => {
			const h = mount();
			h.select(anchor, focus);
			const e = press(key);
			await handleSharedKeydown(e, h.ctx);
			expect(e.defaultPrevented).toBe(true);
			expect(h.read()).toEqual({ anchor: at, focus: at });
		});
	}

	// Option and Cmd arrows on macOS, and Ctrl and Alt arrows elsewhere, are motions of their own.
	// Cmd+Up and Cmd+Down jump to the block's edge instead, which the edge-key rows cover.
	const ALL = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
	for (const [over, keys] of [
		[{ ctrlKey: true }, ALL],
		[{ altKey: true }, ALL],
		[{ metaKey: true }, ['ArrowLeft', 'ArrowRight']],
		[{ shiftKey: true }, ALL]
	] as const) {
		it(`leaves the range to ${JSON.stringify(over)} arrows`, async () => {
			for (const key of keys) {
				const h = mount();
				h.select(2, 4);
				await handleSharedKeydown(press(key, over), h.ctx);
				expect(h.read(), key).toEqual({ anchor: 2, focus: 4 });
			}
		});
	}
});
