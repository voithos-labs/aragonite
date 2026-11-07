import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSpellHover,
	HOVER_GRACE_MS,
	HOVER_OPEN_MS,
	type SpellMenuHandle
} from '#lib/components/editor-root/spell-hover.js';
import type { Misspelling } from '#lib/spell/spell-state.svelte.js';
import type { MarkDecoration, MarkHover } from '#lib/decorations/types.js';

// Miss-analysis: the rest before the menu opens and the grace before it closes are wall-clock,
// which no mounted test can wait on without a timer of its own.

const word: Misspelling = { path: [0], start: 4, end: 8, word: 'tset' };
const other: Misspelling = { path: [0], start: 12, end: 19, word: 'speling' };
const dec = { type: 'mark', path: [0], start: 4, end: 8, class: 'spell-overlay' } as MarkDecoration;
const rect = (x: number) => ({ left: x, top: 10, right: x + 30, bottom: 30 }) as DOMRect;
const hover = (x: number): MarkHover => ({ anchor: rect(x), rects: [rect(x)] });

function harness(state: { menus?: boolean; range?: boolean; onMenu?: boolean } = {}) {
	const opened: { word: string; x: number }[] = [];
	const closed: string[] = [];
	let live: SpellMenuHandle | null = null;
	const open = vi.fn((m: Misspelling, anchor: DOMRect): SpellMenuHandle => {
		opened.push({ word: m.word, x: anchor.left });
		let isOpen = true;
		const handle = {
			isOpen: () => isOpen,
			close: () => {
				if (isOpen) closed.push(m.word);
				isOpen = false;
			}
		};
		live = handle;
		return handle;
	});
	const hoverer = createSpellHover({
		open,
		menusOpen: () => (state.menus ?? false) || !!live?.isOpen(),
		rangeSelected: () => state.range ?? false,
		pointerOnMenu: () => state.onMenu ?? false
	});
	// The pointer settles on the word: hover, then the rest the menu waits for.
	const rest = (m: Misspelling, x: number) => {
		hoverer.interactions(m).onHover!(dec, hover(x));
		vi.advanceTimersByTime(HOVER_OPEN_MS);
	};
	return { hoverer, opened, closed, open, rest, isOpen: () => !!live?.isOpen() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSpellHover', () => {
	it('opens the menu once the pointer has rested on the word, not before', () => {
		const h = harness();
		h.hoverer.interactions(word).onHover!(dec, hover(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
		expect(h.opened).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(h.opened).toEqual([{ word: 'tset', x: 40 }]);
	});

	it('a pointer that passes over the word opens nothing', () => {
		const h = harness();
		h.hoverer.interactions(word).onHover!(dec, hover(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS / 2);
		h.hoverer.interactions(word).onHover!(dec, null);
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		expect(h.opened).toEqual([]);
	});

	it('moving on to another word restarts the rest, then moves the menu there', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.interactions(word).onHover!(dec, null);
		h.hoverer.interactions(other).onHover!(dec, hover(120));
		vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
		expect(h.opened).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(h.closed).toEqual(['tset']);
		expect(h.opened.at(-1)).toEqual({ word: 'speling', x: 120 });
	});

	it('keeps the menu through the grace after the hover ends, then closes it', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.interactions(word).onHover!(dec, null);
		vi.advanceTimersByTime(HOVER_GRACE_MS - 1);
		expect(h.isOpen()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(h.isOpen()).toBe(false);
	});

	it('leaves the menu open when the pointer reached it, and closes it once the pointer leaves', () => {
		const state = { onMenu: false };
		const h = harness(state);
		h.rest(word, 40);
		state.onMenu = true;
		h.hoverer.interactions(word).onHover!(dec, null);
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(h.isOpen()).toBe(true);
		state.onMenu = false;
		h.hoverer.menuLeft();
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(h.isOpen()).toBe(false);
	});

	it('a hover back onto the word within the grace cancels the close', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.interactions(word).onHover!(dec, null);
		vi.advanceTimersByTime(HOVER_GRACE_MS / 2);
		h.hoverer.interactions(word).onHover!(dec, hover(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		expect(h.isOpen()).toBe(true);
		// The same word again keeps the menu it has rather than reopening it.
		expect(h.opened).toHaveLength(1);
	});

	it('opens nothing over another menu or a selected range, but the keyboard route opens at once', () => {
		const busy = harness({ menus: true });
		busy.rest(word, 40);
		expect(busy.opened).toEqual([]);
		const selecting = harness({ range: true });
		selecting.rest(word, 40);
		expect(selecting.opened).toEqual([]);
		selecting.hoverer.interactions(word).onActivate!(dec, { anchor: rect(40) });
		expect(selecting.opened).toEqual([{ word: 'tset', x: 40 }]);
	});

	it('dispose closes what is open and drops a pending open and close', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.interactions(word).onHover!(dec, null);
		h.hoverer.interactions(other).onHover!(dec, hover(120));
		h.hoverer.dispose();
		expect(h.isOpen()).toBe(false);
		vi.advanceTimersByTime(HOVER_OPEN_MS + HOVER_GRACE_MS);
		expect(h.closed).toEqual(['tset']);
		expect(h.opened).toHaveLength(1);
	});
});
