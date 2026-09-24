// @vitest-environment jsdom
// Miss-analysis: every windowing suite handed the list its element before the first read, so
// no case built the height table before the element existed, as a nested list's init does.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import { createListWindowing, type ListWindowing } from '../../reactivity/list-windowing.svelte';
import { makePara } from '../harness/list-windowing.svelte';
import { stubListEl, stubScrollport } from '../harness/stub-scrollport';

const BLOCKS = 5;
const PORT_WIDTH = 1280;
const LIST_WIDTH = 1183;

/** An estimate that is the width it was asked at, so a height names the width behind it. */
const widthOracle: HeightOracle = {
	estimate: (_node, width) => width,
	measured: () => undefined,
	recordMeasured: () => {},
	dropMeasured: () => {}
};

describe("a nested list's first heights", () => {
	it('re-estimates at the list element width once the element mounts', async () => {
		const port = stubScrollport({ viewportHeight: 500, contentWidth: PORT_WIDTH });
		let listEl = $state<HTMLElement | null>(null);
		let windowing!: ListWindowing;
		const cleanup = $effect.root(() => {
			windowing = createListWindowing({
				oracle: widthOracle,
				getChildren: () => Array.from({ length: BLOCKS }, (_, i) => makePara(`p${i}\n`)),
				getChildIds: () => Array.from({ length: BLOCKS }, (_, i) => `b${i}`),
				getListEl: () => listEl,
				getPort: () => port,
				correctsScroll: () => true,
				getFocusPath: () => null,
				getWidthVersion: () => 0,
				getViewportHeightVersion: () => 0,
				getParentPath: () => [0, 0],
				overscan: 2,
				pinExtensionCap: 100,
				activateAbovePx: 1000,
				deactivateBelowPx: 800
			});
		});
		flushSync();
		void windowing.window;

		const el = stubListEl(port, BLOCKS * LIST_WIDTH);
		Object.defineProperty(el, 'clientWidth', { value: LIST_WIDTH });
		listEl = el;
		flushSync();

		// The offset of the last block is the sum of the heights above it.
		await windowing.revealChild(BLOCKS - 1);
		expect(port.scrollTop()).toBe((BLOCKS - 1) * LIST_WIDTH);
		cleanup();
	});
});
