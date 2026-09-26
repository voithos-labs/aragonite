// @vitest-environment jsdom
//
// The chord over a range that lies wholly inside one link edits that link. Create refuses those
// bytes, since they already belong to a construct, so without this branch the key does nothing
// while the toolbar still shows the button pressed: an enabled button that neither opens nor
// writes. Miss-analysis: every create case drove a range over plain text or one crossing a
// construct, so a range contained in one, the shape both branches refuse, never reached the entry.
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { enterLinkCardAtCaret } from '$lib/components/link-card/link-card-entry';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { makeRenderHarness } from '$lib/test/harness/text-render';
import { fixtureReading } from '../../harness/fixture-grammar';
import type { Reading } from '$lib/schema/reading';

/** `Visit [example](https://x.com) now`: the link spans [6, 30), ` now` runs to 34. */
const LINKED = 'Visit [example](https://x.com) now\n';

function mount(source: string): {
	el: HTMLElement;
	node: CstNode;
	reading: Reading;
} {
	const node = parse(source).children[0];
	const harness = makeRenderHarness(node, { mode: 'live' });
	createTextRender(harness.deps).render();
	return { el: harness.el, node, reading: fixtureReading() };
}

/** A real DOM range over raw offsets: a prose block with no marker prefix maps one to one. */
function seat(el: HTMLElement, start: number, end: number): void {
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(createRangeAtDomTextOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
}

function makeCard(crossBlock = false) {
	return createLinkCardState({
		onOpen: () => {},
		canOpen: () => window.getSelection()?.isCollapsed !== false,
		canEnter: () => !crossBlock,
		canOpenCreate: () => true
	});
}

function press(
	source: string,
	start: number,
	end: number,
	crossBlockRange = false
): ReturnType<typeof makeCard> {
	const { el, node, reading } = mount(source);
	seat(el, start, end);
	const card = makeCard(crossBlockRange);
	enterLinkCardAtCaret({
		contentEl: el,
		block: node,
		path: [0],
		reading: fixtureReading(reading, 'live'),
		card,
		selection: start === end ? null : { start, end },
		crossBlockRange
	});
	return card;
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('the chord over a range inside a link', () => {
	it('enters that link’s card, with the focus epoch the chord must supply', () => {
		const card = press(LINKED, 8, 12);
		expect(card.getTarget()).toEqual({ path: [0], sourceStart: 6 });
		expect(card.getCreateTarget()).toBeNull();
		expect(card.getFocusEpoch()).toBeGreaterThan(0);
	});

	it('takes the whole construct’s own bytes as inside it', () => {
		expect(press(LINKED, 6, 30).getTarget()).toEqual({ path: [0], sourceStart: 6 });
	});

	it('a range running out of the link keeps the create fork, which declines those bytes', () => {
		const card = press(LINKED, 2, 10);
		expect(card.getTarget()).toBeNull();
		expect(card.getCreateTarget()).toBeNull();
	});

	it('a range over plain text still creates', () => {
		expect(press(LINKED, 30, 34).getCreateTarget()).toEqual({ path: [0], start: 30, end: 34 });
	});

	it('a collapsed caret inside the link enters it, as it always did', () => {
		expect(press(LINKED, 10, 10).getTarget()).toEqual({ path: [0], sourceStart: 6 });
	});

	// The one check the entry cannot make for itself: block-local offsets are invented there.
	it('a cross-block range enters nothing, even with the offsets inside the link', () => {
		const card = press(LINKED, 8, 12, true);
		expect(card.getTarget()).toBeNull();
		expect(card.getCreateTarget()).toBeNull();
	});
});
