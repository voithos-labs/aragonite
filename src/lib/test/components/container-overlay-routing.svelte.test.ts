// @vitest-environment jsdom
//
// Who paints a container's selection box: one the range covers whole paints its own, markers
// included; one the range cuts through leaves it to the children it cuts. Asserted at the host
// that decides, since nothing on a `containerApi` tells the two cases apart.
//
// Miss-analysis: the previous test asserted "a container with children paints nothing", true
// wherever every visible row is a child block, so a container that draws a row of its own had
// no box at any level.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '$lib/core/parser';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { mountBlockHost, type MountedHost } from './mount-host';
import { installEditorDomStubsForTests } from '$lib/testing';

beforeAll(() => {
	installEditorDomStubsForTests();
	registerBuiltInBlocks();
});

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

/** A live cross-block range spanning doc blocks 0 → 2, so block 1 is held whole. */
function rangeAcrossThreeBlocks() {
	const selection = createSelectionState();
	selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 1 });
	return selection;
}

/** The host's own overlay: `:scope >` excludes the children's nested hosts. */
function ownOverlays(mountedHost: MountedHost): NodeListOf<Element> {
	return mountedHost.el.querySelectorAll(':scope > .selection-overlay');
}

/** Every overlay a nested child host paints inside this one. `:scope` fixes where the search
 *  starts; a plain descendant selector would match the host's own overlay as well. */
function childOverlays(mountedHost: MountedHost): NodeListOf<Element> {
	return mountedHost.el.querySelectorAll(':scope [data-block-path] .selection-overlay');
}

describe('a container the range holds whole paints one box', () => {
	it('paints its own box and leaves its children painting nothing', () => {
		const doc = parse('lead\n\n> quoted\n\ntail\n');
		const selection = rangeAcrossThreeBlocks();

		mounted = mountBlockHost(doc, { index: 1 }, { services: { selection } });
		flushSync();

		expect(ownOverlays(mounted).length).toBe(1);
		expect(childOverlays(mounted).length).toBe(0);
	});

	// Non-vacuity: without this the assertion above passes on an inert range or a
	// classification that never reaches the held-whole class.
	it('still paints a middle leaf under the same range', () => {
		const doc = parse('lead\n\nmiddle prose\n\ntail\n');
		const selection = rangeAcrossThreeBlocks();

		mounted = mountBlockHost(doc, { index: 1 }, { services: { selection } });
		flushSync();

		expect(ownOverlays(mounted).length).toBe(1);
	});

	it('paints a grid itself, whose rows render no hosts to delegate to', () => {
		const doc = parse('lead\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n\ntail\n');
		expect(doc.children[1].kind).toBe('table');
		const selection = rangeAcrossThreeBlocks();

		mounted = mountBlockHost(doc, { index: 1 }, { services: { selection } });
		flushSync();

		expect(ownOverlays(mounted).length).toBe(1);
	});

	it('paints no box of its own when the range ends inside it', () => {
		const doc = parse('lead\n\n> quoted\n>\n> more\n\ntail\n');
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1, 1], offset: 2 });

		mounted = mountBlockHost(doc, { index: 1 }, { services: { selection } });
		flushSync();

		expect(ownOverlays(mounted).length).toBe(0);
		expect(childOverlays(mounted).length).toBeGreaterThan(0);
	});
});

// Miss-analysis: every container case above is one BlockHost mounts, so no test covered a
// container that renders none of its own and had nothing left to paint its box.
describe('a list item the range holds whole paints its own box', () => {
	/** Items 0 and 3 hold the endpoints, so items 1 and 2 are the ones held whole. */
	function rangeAcrossFourItems() {
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [1, 0, 0], offset: 1 }, { path: [1, 3, 0], offset: 1 });
		return selection;
	}

	function itemBoxes(mountedHost: MountedHost): NodeListOf<Element> {
		return mountedHost.el.querySelectorAll(':scope .list-item-block > .selection-overlay-middle');
	}

	it('paints one box per middle item, which its paragraph leaves alone', () => {
		const doc = parse('lead\n\n- a\n- b\n- c\n- d\n\ntail\n');
		expect(doc.children[1].kind).toBe('list');

		mounted = mountBlockHost(
			doc,
			{ index: 1 },
			{ services: { selection: rangeAcrossFourItems() } }
		);
		flushSync();

		expect(itemBoxes(mounted).length).toBe(2);
		expect(
			mounted.el.querySelectorAll(':scope [data-block-path] .selection-overlay-middle').length
		).toBe(0);
	});

	it('leaves a nested sub-list under a middle item painting nothing', () => {
		const doc = parse('lead\n\n- a\n- b\n  - b1\n- c\n- d\n\ntail\n');

		mounted = mountBlockHost(
			doc,
			{ index: 1 },
			{ services: { selection: rangeAcrossFourItems() } }
		);
		flushSync();

		expect(itemBoxes(mounted).length).toBe(2);
		expect(
			mounted.el.querySelectorAll("[data-block-path='[1,1,1]'] .selection-overlay").length
		).toBe(0);
	});
});
