// @vitest-environment jsdom
//
// Who paints a container's selection rects: a child-bearing container delegates
// downward, one with no child hosts paints itself. Pinned behaviorally at the host
// that decides, because the members a `containerApi` publisher exposes no longer
// discriminate the two — a presence check washes every blockquote and list inside a
// cross-block range over its children's rects.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '$lib/core/parser';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { installBlockHostLayoutStubs, mountBlockHost, type MountedHost } from './mount-host';

beforeAll(() => {
	installBlockHostLayoutStubs();
	registerBuiltInBlocks();
});

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

/** A live cross-block range spanning doc blocks 0 → 2, so block 1 is a middle block. */
function rangeAcrossThreeBlocks() {
	const selection = createSelectionState();
	selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 1 });
	return selection;
}

/** The host's OWN overlay: `:scope >` excludes the children's nested hosts. */
function ownOverlays(mountedHost: MountedHost): NodeListOf<Element> {
	return mountedHost.el.querySelectorAll(':scope > .selection-overlay');
}

describe('a container inside a cross-block range delegates its painting downward', () => {
	it('paints no overlay of its own when its children have hosts', () => {
		const doc = parse('lead\n\n> quoted\n\ntail\n');
		const selection = rangeAcrossThreeBlocks();

		mounted = mountBlockHost(doc, { index: 1 }, { services: { selection } });
		flushSync();

		expect(ownOverlays(mounted).length).toBe(0);
	});

	// Non-vacuity: without this the assertion above passes on an inert range or a
	// classification that never reaches 'middle'.
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
});
