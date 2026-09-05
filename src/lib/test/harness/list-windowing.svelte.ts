/**
 * The `createListWindowing` mount ceremony the windowing suites share: a stubbed port and list
 * element, an `$effect.root`, and the wiring every scope takes. A suite passes only the fixture
 * and the option it tunes; everything else comes from the defaults below.
 */
import { flushSync } from 'svelte';
import {
	createListWindowing,
	type ListWindowing,
	type ListWindowingDeps
} from '../../reactivity/list-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { Scrollport } from '../../cursor/scrollport';
import type { CstNode } from '../../core/nodes';
import { stubListEl, stubScrollport } from './stub-scrollport';

// ── Fixtures ────────────────────────────────────────────────────────────────

export const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

/** Every block the same height, whatever its id. */
export function fixedOracle(px: number): HeightOracle {
	return {
		estimate: () => px,
		measured: () => undefined,
		recordMeasured: () => {},
		height: () => px,
		dropMeasured: () => {}
	};
}

/** Height BY ID, so a permutation the model tracks changes each index's offset. */
export function heightsOracle(heights: Record<string, number>, estimate = 10): HeightOracle {
	return {
		estimate: () => estimate,
		measured: () => undefined,
		recordMeasured: () => {},
		height: (id: string) => heights[id] ?? estimate,
		dropMeasured: () => {}
	};
}

// ── Mount ───────────────────────────────────────────────────────────────────

export type MountListWindowingOptions = Partial<ListWindowingDeps> & {
	/** Caller-owned so a suite can mutate it under a live scope; read only through the getter. */
	children: readonly CstNode[];
	ids: string[];
	oracle: HeightOracle;
	listHeight: number;
	viewportHeight?: number;
	viewportTop?: number;
	maxScrollTop?: number;
	/** Chrome between the port's content origin and this list's first block. */
	chromeAbove?: number;
};

export interface MountedListWindowing {
	windowing: ListWindowing;
	port: Scrollport;
	cleanup: () => void;
}

export function mountListWindowing(options: MountListWindowingOptions): MountedListWindowing {
	const {
		children,
		ids,
		oracle,
		listHeight,
		viewportHeight = 500,
		viewportTop,
		maxScrollTop,
		chromeAbove,
		...deps
	} = options;
	const port = stubScrollport({ viewportHeight, viewportTop, maxScrollTop });
	const listEl = stubListEl(port, listHeight, chromeAbove);

	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle,
			getChildren: () => children,
			getChildIds: () => ids,
			getListEl: () => listEl,
			getPort: () => port,
			correctsScroll: () => true,
			getFocusPath: () => null,
			getWidthVersion: () => 0,
			getViewportHeightVersion: () => 0,
			getParentPath: () => [],
			overscan: 2,
			pinExtensionCap: 100,
			activateAbovePx: 1000,
			deactivateBelowPx: 800,
			...deps
		});
	});
	flushSync();
	return { windowing, port, cleanup };
}
