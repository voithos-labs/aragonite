// @vitest-environment jsdom
//
// The chord over a range that lies WHOLLY inside one link edits that link. Create declines those
// bytes (they are already a construct's), so without this fork the press is inert while the
// toolbar paints the button pressed — an enabled affordance that neither opens nor writes.
// Miss-analysis: every create case drove a range over plain text or one CROSSING a construct, so
// the contained range — the only shape both forks refuse to claim — was never fed to the entry.
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import type { LinkReferenceResolverRef } from '$lib/editor-keys';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { enterLinkCardAtCaret } from '$lib/components/link-card/link-card-entry';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets } from '$lib/cursor/content-offsets';
import { makeRenderHarness } from '$lib/test/harness/text-render';

/** `Visit [example](https://x.com) now`: the link spans [6, 30), ` now` runs to 34. */
const LINKED = 'Visit [example](https://x.com) now\n';

function mount(source: string): {
	el: HTMLElement;
	node: CstNode;
	linkRef: LinkReferenceResolverRef;
} {
	const node = parse(source).children[0];
	const harness = makeRenderHarness(node, { mode: 'live' });
	createTextRender(harness.deps).render();
	return { el: harness.el, node, linkRef: {} };
}

/** A real DOM range over raw offsets — a zero-ambient prose block walks 1:1. */
function seat(el: HTMLElement, start: number, end: number): void {
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
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
	const { el, node, linkRef } = mount(source);
	seat(el, start, end);
	const card = makeCard(crossBlockRange);
	enterLinkCardAtCaret({
		contentEl: el,
		block: node,
		path: [0],
		linkRef,
		card,
		mode: 'live',
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
	it('enters THAT link’s card, with the focus epoch the chord owes', () => {
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

	// The one guard the entry cannot prove for itself: block-local offsets are fabricated there.
	it('a cross-block range enters nothing, even with the offsets inside the link', () => {
		const card = press(LINKED, 8, 12, true);
		expect(card.getTarget()).toBeNull();
		expect(card.getCreateTarget()).toBeNull();
	});
});
