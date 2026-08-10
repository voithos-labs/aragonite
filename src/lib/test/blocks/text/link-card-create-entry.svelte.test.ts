// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { enterLinkCardAtCaret } from '$lib/components/link-card/link-card-entry';

// How create mode opens and declines: the state's own `canOpenCreate` door, and the entry's
// vetting of the range ahead of it. The chord path is the ONLY entry that may create.

function makeState(allowCreate: () => boolean = () => true) {
	const onOpen = vi.fn();
	const card = createLinkCardState({ onOpen, canOpen: () => true, canOpenCreate: allowCreate });
	return { card, onOpen };
}

describe('the create door', () => {
	it('declines when canOpenCreate says no, seating nothing', () => {
		const { card, onOpen } = makeState(() => false);
		expect(card.enterCreate({ path: [0], start: 1, end: 3 })).toBe(false);
		expect(card.getCreateTarget()).toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('seats the range, snapshots the caret and bumps the focus epoch', () => {
		const { card, onOpen } = makeState();
		expect(card.enterCreate({ path: [0], start: 6, end: 11 })).toBe(true);
		expect(card.getCreateTarget()).toEqual({ path: [0], start: 6, end: 11 });
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(card.getFocusEpoch()).toBeGreaterThan(0);
	});

	it('one card, one target: each entry kind clears the other, and close clears both', () => {
		const { card } = makeState();
		card.enterCreate({ path: [0], start: 6, end: 11 });
		card.enter({ path: [0], sourceStart: 6 });
		expect(card.getCreateTarget()).toBeNull();
		expect(card.getTarget()).not.toBeNull();
		card.enterCreate({ path: [0], start: 6, end: 11 });
		expect(card.getTarget()).toBeNull();
		expect(card.getCreateTarget()).not.toBeNull();
		card.close();
		expect(card.getCreateTarget()).toBeNull();
	});
});

describe('the chord entry vets the range before the door', () => {
	function enter(
		card: ReturnType<typeof makeState>['card'],
		source: string,
		selection: { start: number; end: number } | null,
		mode: 'live' | 'source' = 'live'
	): void {
		enterLinkCardAtCaret({
			contentEl: document.createElement('div'),
			block: parse(source).children[0] as NodeView,
			path: [0],
			card,
			mode,
			selection
		});
	}

	it('a plain-text selection enters create mode on the range', () => {
		const { card } = makeState();
		enter(card, 'Alpha bravo charlie\n', { start: 6, end: 11 });
		expect(card.getCreateTarget()).toEqual({ path: [0], start: 6, end: 11 });
	});

	it('a selection crossing a link declines: neither card mode opens', () => {
		const { card } = makeState();
		enter(card, 'Visit [example](https://e.c) now\n', { start: 2, end: 9 });
		expect(card.getCreateTarget()).toBeNull();
		expect(card.getTarget()).toBeNull();
	});

	it('outside live mode the chord enters nothing', () => {
		const { card } = makeState();
		enter(card, 'Alpha bravo charlie\n', { start: 6, end: 11 }, 'source');
		expect(card.getCreateTarget()).toBeNull();
	});

	it('a degenerate range is not a create gesture', () => {
		const { card } = makeState();
		enter(card, 'Alpha bravo charlie\n', { start: 6, end: 6 });
		expect(card.getCreateTarget()).toBeNull();
	});
});
