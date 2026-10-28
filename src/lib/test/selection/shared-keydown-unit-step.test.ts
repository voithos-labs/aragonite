// @vitest-environment jsdom
// Miss-analysis: every step-over row ran in Chromium, whose native arrow already crosses a widget
// and a CRLF pair in one press, so nothing asked the shared keydown to decide the step.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	handleSharedKeydown,
	type CaretUnit,
	type SharedKeydownContext
} from '#lib/selection/shared-keydown.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import type { FocusActions } from '#lib/action-contracts.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { makeCaretMemory } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { commandContext } from '#lib/test/harness/command-context.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

const noCross = {
	handleKeyDown: async () => false
} as unknown as CrossBlockHandlers;

// `abcdef` with one span over `bcd`, which the stub source reports from either side.
const SPAN: CaretUnit = { start: 1, end: 4 };

function mount() {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = 'abcdef';
	document.body.appendChild(el);
	const text = el.firstChild as Text;
	const focusOffset = () => {
		const sel = window.getSelection()!;
		return sel.focusNode === text ? sel.focusOffset : null;
	};
	const asked: { offset: number; direction: string; extending: boolean }[] = [];
	const crossed = vi.fn();
	const selection = createSelectionState();
	const caretMemory = makeCaretMemory();
	const noteKey = vi.spyOn(caretMemory, 'noteKey');
	const showSelectionEnd = vi.fn(async () => {});
	const ctx: SharedKeydownContext = {
		caretWriter: testCaretWriter,
		caretLanding: { restore: async () => 'applied' as const, showSelectionEnd },
		commands: commandContext(),
		reading: fixtureReading(),
		scroll: { visibleBand: () => null, showRect: () => {} },
		getEl: () => el,
		getCursorOffset: () => {
			const sel = window.getSelection()!;
			return sel.isCollapsed ? focusOffset() : Math.min(sel.anchorOffset, sel.focusOffset);
		},
		getFocusOffset: focusOffset,
		getTextLen: () => 6,
		getMyPath: () => [0],
		getIndex: () => 0,
		crossBlock: noCross,
		selection,
		caretMemory,
		history: {} as SharedKeydownContext['history'],
		focus: {} as FocusActions,
		getDoc: () => ({ kind: 'document', children: [] }) as never,
		caretUnits: {
			beside: (offset, direction, extending) => {
				asked.push({ offset, direction, extending });
				const forward = direction === 'forward';
				return (forward ? offset === SPAN.start : offset === SPAN.end) ? SPAN : null;
			},
			crossed
		}
	};
	const select = (anchor: number, focus = anchor) =>
		window.getSelection()!.setBaseAndExtent(text, anchor, text, focus);
	const read = () => {
		const sel = window.getSelection()!;
		return { anchor: sel.anchorOffset, focus: sel.focusOffset };
	};
	return { ctx, select, read, asked, crossed, noteKey, selection, showSelectionEnd };
}

const press = (key: string, over: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key, cancelable: true, ...over });

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('handleSharedKeydown: a span the caret cannot stop inside is crossed in one press', () => {
	const rows = [
		{ key: 'ArrowRight', shift: false, from: 1, anchor: 4, focus: 4 },
		{ key: 'ArrowLeft', shift: false, from: 4, anchor: 1, focus: 1 },
		{ key: 'ArrowRight', shift: true, from: 1, anchor: 1, focus: 4 },
		{ key: 'ArrowLeft', shift: true, from: 4, anchor: 4, focus: 1 }
	];
	for (const row of rows) {
		it(`${row.shift ? 'Shift+' : ''}${row.key} from ${row.from} lands at the span's far edge`, async () => {
			const h = mount();
			h.select(row.from);
			const e = press(row.key, { shiftKey: row.shift });
			expect(await handleSharedKeydown(e, h.ctx)).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(h.read()).toEqual({ anchor: row.anchor, focus: row.focus });
			expect(h.crossed).toHaveBeenCalledTimes(1);
			// The key note runs first, so the step resets the sticky column like any horizontal one.
			expect(h.noteKey).toHaveBeenCalledTimes(1);
			// A moved selection end is shown; a moved caret is the caret landing's business.
			expect(h.showSelectionEnd).toHaveBeenCalledTimes(row.shift ? 1 : 0);
		});
	}

	it('extends from a range’s focus, not its start', async () => {
		const h = mount();
		h.select(0, 1);
		expect(await handleSharedKeydown(press('ArrowRight', { shiftKey: true }), h.ctx)).toBe(true);
		expect(h.read()).toEqual({ anchor: 0, focus: 4 });
	});

	it('leaves every other press to the browser', async () => {
		const declined: [string, KeyboardEventInit, number][] = [
			['ArrowRight', { ctrlKey: true }, 1],
			['ArrowRight', { altKey: true }, 1],
			['ArrowRight', { metaKey: true }, 1],
			['ArrowRight', {}, 2],
			['ArrowLeft', {}, 1]
		];
		for (const [key, over, at] of declined) {
			const h = mount();
			h.select(at);
			const e = press(key, over);
			expect(await handleSharedKeydown(e, h.ctx), `${key} ${JSON.stringify(over)}`).toBe(false);
			expect(e.defaultPrevented).toBe(false);
			expect(h.crossed).not.toHaveBeenCalled();
		}
	});

	it('reads the caret once for a press it declines, which the boundary check reuses', async () => {
		for (const shiftKey of [false, true]) {
			const h = mount();
			h.select(2);
			const cursor = vi.spyOn(h.ctx, 'getCursorOffset');
			const focus = vi.spyOn(h.ctx, 'getFocusOffset');
			expect(await handleSharedKeydown(press('ArrowRight', { shiftKey }), h.ctx)).toBe(false);
			expect(cursor.mock.calls.length + focus.mock.calls.length, `shift ${shiftKey}`).toBe(1);
		}
	});

	it('leaves a selection across blocks to its own handler', async () => {
		const h = mount();
		h.select(1);
		vi.spyOn(h.selection, 'isCrossBlock', 'get').mockReturnValue(true);
		expect(await handleSharedKeydown(press('ArrowRight'), h.ctx)).toBe(false);
		expect(h.asked).toEqual([]);
	});

	it('asks after a hidden construct edge, which claims the press first', async () => {
		const h = mount();
		h.select(1);
		h.ctx.stepEdge = () => true;
		expect(await handleSharedKeydown(press('ArrowRight'), h.ctx)).toBe(true);
		expect(h.asked).toEqual([]);
		expect(h.read().focus).toBe(1);
	});
});
