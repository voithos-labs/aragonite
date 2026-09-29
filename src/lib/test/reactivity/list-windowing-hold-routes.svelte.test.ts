// @vitest-environment jsdom
// Miss-analysis: each correction had its own tests and its own pick of the held block, so no test
// ran one focused layout through every route that changes a list's heights.
import { describe, it, expect } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { MeasuredHeightOracle } from '../../cursor/height-oracle';
import { createLayoutState } from '../../reactivity/layout-state.svelte';
import type { CstNode } from '../../core/nodes';
import type { ListWindowing } from '../../reactivity/list-windowing.svelte';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';
import {
	focusFollowing,
	makePara,
	mountListWindowing,
	type MountedListWindowing
} from '../harness/list-windowing.svelte';

// Ten 100px blocks; the viewport's top sits inside b1 and the caret is in b5, 350px down the
// viewport. Every route below changes a height between the two, so only holding b5 keeps it still.
const COUNT = 10;
const HEIGHT = 100;
const SCROLL_TOP = 150;
const FOCUSED_INDEX = 5;
const FOCUSED = `b${FOCUSED_INDEX}`;
const CHANGED = 'b3';
const GROWN = 160;

const idOf = (i: number) => `b${i}`;

function liveOracle(): MeasuredHeightOracle & { measuredHeights: Map<string, number> } {
	const measuredHeights = new Map<string, number>();
	return {
		measuredHeights,
		estimate: () => HEIGHT,
		measured: (id) => measuredHeights.get(id),
		recordMeasured: (id, h) => void measuredHeights.set(id, h),
		dropMeasured: () => measuredHeights.clear(),
		measuredIds: () => [...measuredHeights.keys()]
	};
}

interface Fixture {
	scope: MountedListWindowing;
	children: CstNode[];
	ids: string[];
	oracle: ReturnType<typeof liveOracle>;
	bumpWidth(): void;
	/** Registers `CHANGED` reading whatever `height.px` holds, and waits for its first measure. */
	mountChanged(): Promise<{ px: number }>;
}

function mount(): Fixture {
	const children = $state(Array.from({ length: COUNT }, (_, i) => makePara(`p${i}\n`)));
	const ids = $state(Array.from({ length: COUNT }, (_, i) => idOf(i)));
	const oracle = liveOracle();
	const layout = createLayoutState({ heightOracle: oracle });
	const focus = focusFollowing(ids, FOCUSED);
	const scope = mountListWindowing({
		children,
		ids,
		oracle,
		listHeight: COUNT * HEIGHT,
		getWidthVersion: layout.widthVersion,
		getFocusPath: focus.getFocusPath
	});
	const cleanup = scope.cleanup;
	scope.cleanup = () => {
		focus.stop();
		cleanup();
	};
	scope.port.setScrollTop(SCROLL_TOP);
	return {
		scope,
		children,
		ids,
		oracle,
		bumpWidth: () => {
			layout.rebuildForNewGeometry();
			flushSync();
		},
		async mountChanged() {
			const height = { px: HEIGHT };
			const index = ids.indexOf(CHANGED);
			scope.windowing.registerChild(CHANGED, {
				index,
				readHeight: () => height.px
			});
			await settleMeasures();
			return height;
		}
	};
}

async function settleMeasures(): Promise<void> {
	await tick();
	await tick();
}

/** The focused block's top relative to the viewport's top, by the height table. */
function focusedScreenTop({ scope, ids }: Fixture): number {
	const at = scope.windowing.targetTopOf(ids.indexOf(FOCUSED));
	if (!at) throw new Error('the focused block is out of the table');
	return at.top - scope.port.scrollTop();
}

interface Route {
	name: string;
	change(f: Fixture): Promise<void> | void;
}

/** Every way a list's heights change, each through the member or dependency a caller drives. */
const ROUTES: Route[] = [
	{
		name: 'the batched measure of a new block',
		async change(f) {
			const index = f.ids.indexOf(CHANGED);
			f.scope.windowing.registerChild(CHANGED, {
				index,
				readHeight: () => GROWN
			});
			await settleMeasures();
		}
	},
	{
		name: 'measureChildNow after an edit',
		async change(f) {
			const height = await f.mountChanged();
			height.px = GROWN;
			f.scope.windowing.measureChildNow(CHANGED);
		}
	},
	{
		name: 'measureChildOnResize after later growth',
		async change(f) {
			const height = await f.mountChanged();
			height.px = GROWN;
			f.scope.windowing.measureChildOnResize(CHANGED, GROWN);
		}
	},
	{
		name: 'a structural insert',
		change(f) {
			const at = f.ids.indexOf(CHANGED);
			f.children.splice(at, 0, makePara('new\n'));
			f.ids.splice(at, 0, 'inserted');
			flushSync();
		}
	},
	{
		name: 'a structural delete',
		change(f) {
			const at = f.ids.indexOf(CHANGED);
			f.children.splice(at, 1);
			f.ids.splice(at, 1);
			flushSync();
		}
	},
	{
		name: 'a same-length reorder',
		change(f) {
			// b7 moves up above the caret's block, so the count stays and b5 slides down a block.
			const [child] = f.children.splice(7, 1);
			const [id] = f.ids.splice(7, 1);
			const at = f.ids.indexOf(CHANGED);
			f.children.splice(at, 0, child);
			f.ids.splice(at, 0, id);
			flushSync();
		}
	},
	{
		name: 'a width rebuild re-measuring a mounted block',
		async change(f) {
			const height = await f.mountChanged();
			height.px = GROWN;
			f.bumpWidth();
		}
	}
];

/** The members that change no height, or change one without a correction of their own. */
const NOT_ROUTES: (keyof ListWindowing)[] = [
	'window',
	'level',
	'targetTopOf',
	'syncScrollTop',
	'revealChild',
	'isInWindow',
	'dispose'
];
/** The members a route above drives; the structural and width rows drive the list's inputs. */
const ROUTE_MEMBERS: (keyof ListWindowing)[] = [
	'registerChild',
	'measureChildNow',
	'measureChildOnResize'
];

describe('list-windowing: every height change holds the focused block below the top', () => {
	it('each member is a route with a row or a declared non-route', () => {
		const f = mount();
		const members = Object.keys(f.scope.windowing).sort();
		f.scope.cleanup();
		expect(members).toEqual([...ROUTE_MEMBERS, ...NOT_ROUTES].sort());
	});

	for (const route of ROUTES) {
		it(route.name, async () => {
			const f = mount();
			const before = focusedScreenTop(f);
			await route.change(f);
			await tick();
			expect(focusedScreenTop(f)).toBe(before);
			f.scope.cleanup();
		});
	}
});

describe('list-windowing: a reorder that moves the focused block leaves the page', () => {
	for (const [direction, to] of [
		['up past b4', 4],
		['down past b6', 6]
	] as const) {
		it(`the focused block moved ${direction}: scrollTop stays`, async () => {
			const f = mount();
			const [child] = f.children.splice(FOCUSED_INDEX, 1);
			const [id] = f.ids.splice(FOCUSED_INDEX, 1);
			f.children.splice(to, 0, child);
			f.ids.splice(to, 0, id);
			flushSync();
			await tick();
			expect(f.scope.port.scrollTop()).toBe(SCROLL_TOP);
			f.scope.cleanup();
		});
	}

	// Miss-analysis: the rebuild read a focus index noted when focus arrived, and no row edited
	// again after a reorder that kept focus, where that index names the neighbour.
	for (const [what, change] of [
		[
			'a block added right after it',
			(f: Fixture) => {
				f.children.splice(FOCUSED_INDEX, 0, makePara('new\n'));
				f.ids.splice(FOCUSED_INDEX, 0, 'added');
				flushSync();
			}
		],
		[
			'it measuring taller',
			async (f: Fixture) => {
				const at = f.ids.indexOf(FOCUSED);
				f.scope.windowing.registerChild(FOCUSED, {
					index: at,
					readHeight: () => GROWN
				});
				await settleMeasures();
			}
		]
	] as const) {
		it(`the focused block holds through ${what}, once a reorder moved it up`, async () => {
			const f = mount();
			const [child] = f.children.splice(FOCUSED_INDEX, 1);
			const [id] = f.ids.splice(FOCUSED_INDEX, 1);
			f.children.splice(FOCUSED_INDEX - 1, 0, child);
			f.ids.splice(FOCUSED_INDEX - 1, 0, id);
			flushSync();
			await tick();
			const before = focusedScreenTop(f);
			await change(f);
			await tick();
			expect(focusedScreenTop(f)).toBe(before);
			f.scope.cleanup();
		});
	}
});

describe('list-windowing: only a rebuild checks whether the focused block moved', () => {
	it('a measure makes no neighbour pass; a structural edit makes one', async () => {
		enablePerfInstruments();
		resetPerfInstruments();
		const f = mount();
		const height = await f.mountChanged();
		height.px = GROWN;
		f.scope.windowing.measureChildNow(CHANGED);
		await tick();
		const afterMeasure = perfSnapshot().neighbourPasses;
		f.children.splice(1, 1);
		f.ids.splice(1, 1);
		flushSync();
		await tick();
		const afterRebuild = perfSnapshot().neighbourPasses;
		f.scope.cleanup();
		disablePerfInstruments();
		expect({ afterMeasure, afterRebuild }).toEqual({ afterMeasure: 0, afterRebuild: 1 });
	});
});
