// @vitest-environment jsdom
//
// The gap indicator at the WINDOWED seam: a boundary index equal to the slice's end while
// blocks below it stay unmounted. No scroll position holds that state in a browser (the
// window recompute jumps past it), so the honest oracle is a synthetic WindowResult here.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockList from '$lib/components/BlockList.svelte';
import type { BlockComponent } from '$lib/block-component';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { parse } from '$lib/core/parser';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import type { WindowResult } from '$lib/reactivity/block-window.svelte';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { editorMountContext } from '../harness/mount-context';
import { installBlockHostLayoutStubs } from './mount-host';

const BLOCK_COUNT = 6;
const SLICE_END = 3;

beforeAll(() => {
	installBlockHostLayoutStubs();
	registerBuiltInBlocks();
});

/** Active and short of the document, which is the whole point: an inactive window slices
 *  to `children.length`, the one state this test exists to avoid. */
const WINDOW: WindowResult = {
	active: true,
	start: 0,
	end: SLICE_END,
	topSpacerPx: 0,
	bottomSpacerPx: 400
};

interface Mounted {
	target: HTMLElement;
	dispose: () => Promise<void>;
}

let mounted: Mounted | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

/** A windowed BlockList over `BLOCK_COUNT` paragraphs with the gap parked at `gapIndex`. */
function mountWindowedList(gapIndex: number): Mounted {
	const doc = parse(Array.from({ length: BLOCK_COUNT }, (_, i) => `para ${i}\n`).join('\n'));
	expect(doc.children).toHaveLength(BLOCK_COUNT);
	const selection = createSelectionState();
	selection.setGapCaret({ parentPath: [], index: gapIndex });

	const refs: (BlockComponent | undefined)[] = [];
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BlockList, {
		target,
		props: {
			children: doc.children,
			blockIds: doc.children.map((_, i) => `block-${i}`),
			slots: refSlotsOver(refs),
			parentPath: [],
			window: WINDOW
		},
		context: editorMountContext({ doc: { doc: () => doc }, services: { selection } })
	});
	flushSync();
	return {
		target,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

describe('the gap indicator at a windowed slice boundary', () => {
	it('renders the slice short of the document, so the seam is a real state', () => {
		mounted = mountWindowedList(SLICE_END);

		expect(mounted.target.querySelectorAll('.block-host')).toHaveLength(SLICE_END);
		expect(SLICE_END).toBeLessThan(BLOCK_COUNT);
	});

	it('paints the boundary at the slice end, after the last mounted block', () => {
		mounted = mountWindowedList(SLICE_END);

		const painted = mounted.target.querySelectorAll('[data-gap-caret]');
		expect(painted).toHaveLength(1);
		// Document order is the claim: the seam sits past the last rendered host, not
		// between two of them.
		const hosts = mounted.target.querySelectorAll('.block-host');
		const last = hosts[hosts.length - 1];
		expect(last.compareDocumentPosition(painted[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	// The windowed-out blocks below the seam own their own boundaries; painting one here
	// would put the caret's line at a boundary the user is not looking at.
	it('paints nothing for a boundary past the slice end', () => {
		mounted = mountWindowedList(SLICE_END + 1);

		expect(mounted.target.querySelectorAll('[data-gap-caret]')).toHaveLength(0);
	});
});
