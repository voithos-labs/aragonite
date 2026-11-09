import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSpellHover,
	HOVER_GRACE_MS,
	HOVER_OPEN_MS,
	type SpellMenuHandle
} from '#packages/spellcheck/src/hover.js';
import type { Misspelling } from '#packages/spellcheck/src/words.js';

const word: Misspelling = { from: 4, to: 8, word: 'tset' };
const other: Misspelling = { from: 12, to: 19, word: 'speling' };
const rect = (x: number) => ({ left: x, top: 10, right: x + 30, bottom: 30 }) as DOMRect;

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
		hoverer.hover(m, rect(x));
		vi.advanceTimersByTime(HOVER_OPEN_MS);
	};
	return { hoverer, opened, closed, rest, isOpen: () => !!live?.isOpen() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSpellHover', () => {
	it('opens the menu once the pointer has rested on the word, not before', () => {
		const h = harness();
		h.hoverer.hover(word, rect(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
		expect(h.opened).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(h.opened).toEqual([{ word: 'tset', x: 40 }]);
	});

	it('a pointer that passes over the word opens nothing', () => {
		const h = harness();
		h.hoverer.hover(word, rect(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS / 2);
		h.hoverer.left();
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		expect(h.opened).toEqual([]);
	});

	it('moving on to another word restarts the rest, then moves the menu there', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.left();
		h.hoverer.hover(other, rect(120));
		vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
		expect(h.opened).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(h.closed).toEqual(['tset']);
		expect(h.opened.at(-1)).toEqual({ word: 'speling', x: 120 });
	});

	it('keeps the menu through the grace after the hover ends, then closes it', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.left();
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
		h.hoverer.left();
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(h.isOpen()).toBe(true);
		state.onMenu = false;
		h.hoverer.menuLeft();
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(h.isOpen()).toBe(false);
	});

	it('a hover back onto the word within the grace cancels the close and keeps the same menu', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.left();
		vi.advanceTimersByTime(HOVER_GRACE_MS / 2);
		h.hoverer.hover(word, rect(40));
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		expect(h.isOpen()).toBe(true);
		expect(h.opened).toHaveLength(1);
	});

	it('opens nothing over another menu or a selected range, but the keyboard route opens at once', () => {
		const busy = harness({ menus: true });
		busy.rest(word, 40);
		expect(busy.opened).toEqual([]);
		const selecting = harness({ range: true });
		selecting.rest(word, 40);
		expect(selecting.opened).toEqual([]);
		selecting.hoverer.activate(word, rect(40));
		expect(selecting.opened).toEqual([{ word: 'tset', x: 40 }]);
	});

	it('the keyboard route on the word whose menu shows keeps that menu', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.activate(word, rect(40));
		expect(h.opened).toHaveLength(1);
		expect(h.closed).toEqual([]);
	});

	it('dispose closes what is open and drops a pending open and close', () => {
		const h = harness();
		h.rest(word, 40);
		h.hoverer.left();
		h.hoverer.hover(other, rect(120));
		h.hoverer.dispose();
		expect(h.isOpen()).toBe(false);
		vi.advanceTimersByTime(HOVER_OPEN_MS + HOVER_GRACE_MS);
		expect(h.closed).toEqual(['tset']);
		expect(h.opened).toHaveLength(1);
	});
});
