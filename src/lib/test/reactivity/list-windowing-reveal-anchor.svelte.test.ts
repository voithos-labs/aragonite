// @vitest-environment jsdom
// A scroll into view wins over the rule for holding a block still: a round re-places the target's
// absolute position after a change, because the browser's own clamping outpaces a relative delta
// while unmounted images still measure about zero.
import { describe, it, expect, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { PlaceBlock } from '../../cursor/scroll-owner';
import {
	heightsOracle,
	makePara,
	mountListWindowing,
	mountNestedList,
	type MountListWindowingOptions,
	type MountedListWindowing
} from '../harness/list-windowing.svelte';

const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };

const sixParas = () => [0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`));
const sixIds = () => ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];

/** A root block list over six blocks with heights b0..b5 = 10..60. */
function mountScope(overrides: Partial<MountListWindowingOptions> = {}): MountedListWindowing {
	return mountListWindowing({
		oracle: heightsOracle(HEIGHTS),
		children: sixParas(),
		ids: sixIds(),
		listHeight: 200,
		...overrides
	});
}

const hold = (scope: MountedListWindowing, path: number[], block: PlaceBlock = 'nearest') =>
	scope.owner.place(path, { block, hold: true });

/** Registers `id` at `index`, lets the batch take its first height, then reports it resized. */
async function growOnResize(
	windowing: MountedListWindowing['windowing'],
	id: string,
	index: number,
	from: number,
	to: number
): Promise<() => void> {
	let height = from;
	windowing.registerChild(id, { index, readHeight: () => height });
	await tick();
	return () => {
		height = to;
		windowing.measureChildOnResize(id, to);
	};
}

describe('list-windowing reveal anchor', () => {
	it('re-places the held target through a structural rebuild', async () => {
		const children = $state(sixParas());
		const ids = $state(sixIds());
		const scope = mountScope({ children, ids });
		const { windowing, cleanup, port } = scope;

		// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. Put b1 at the top of the viewport, so the
		// block held by default is not the one being scrolled to.
		await windowing.revealChild(1);
		expect(port.scrollTop()).toBe(10);
		hold(scope, [5]);

		// A 10px block goes in first, so path [5] now names b4, at 110; holding b1 instead would
		// move the page by 10.
		children.splice(0, 0, makePara('new\n'));
		ids.splice(0, 0, 'bNew');
		flushSync();
		await tick();

		expect(port.scrollTop()).toBe(110);
		cleanup();
	});

	// Miss-analysis (GH #32): no case drove a container above the target growing, only corrections.
	it('re-places the target when a container above it grows, measured by its host', async () => {
		const scope = mountScope();
		await scope.windowing.revealChild(4);
		expect(scope.port.scrollTop()).toBe(100);
		hold(scope, [4]);

		(await growOnResize(scope.windowing, 'b2', 2, 30, 130))();
		await tick();

		expect(scope.port.scrollTop()).toBe(200);
		scope.cleanup();
	});

	// A target inside a container is not the container: re-placing the ancestor's top pushes
	// the target a container's height out of view on the next measure pass.
	const CHROME = 35;
	const TARGET_HEIGHT = 8;
	const NESTED_CASES: Array<[PlaceBlock, number, number]> = [
		// b3 grows 40, so b5 lands at 190; the target sits 35px into it.
		['nearest', 500, 190 + CHROME],
		// Centred on the target's own box: the ancestor's height of 60 would place it 26px off.
		['center', 100, 190 + CHROME - (100 - TARGET_HEIGHT) / 2]
	];
	for (const [block, viewport, expected] of NESTED_CASES) {
		it(`re-places a nested '${block}' target at its own position inside the ancestor`, async () => {
			const scope = mountScope({ viewportHeight: viewport, listHeight: 80 });
			const nested = mountNestedList({
				root: scope,
				at: 5,
				children: [makePara('n0\n')],
				ids: ['n0'],
				oracle: heightsOracle({ n0: TARGET_HEIGHT }),
				listHeight: TARGET_HEIGHT,
				chromeAbove: CHROME
			});
			await scope.windowing.revealChild(1);
			expect(scope.port.scrollTop()).toBe(10);
			hold(scope, [5, 0], block);

			(await growOnResize(scope.windowing, 'b3', 3, 40, 80))();
			await tick();

			expect(scope.port.scrollTop()).toBe(expected);
			nested.cleanup();
			scope.cleanup();
		});
	}
});

// Miss-analysis: with no list reporting its height upward, the container's own list and the list
// above it each corrected one growth, and no unit row ran a growth through two nested tables.
describe('one growth inside a container is corrected once', () => {
	// b2 is a container of three 10px blocks; the viewport's top sits 5px into n1, and n0 grows
	// 100px, which the root measures as b2 growing by the same 100px in the same round.
	const GROWTH = 100;
	for (const [name, focus] of [
		['no caret', null],
		['the caret in b4, below the container', [4]]
	] as const) {
		it(`one write of the growth's size: ${name}`, async () => {
			const scope = mountScope({ getFocusPath: () => (focus ? [...focus] : null) });
			const nested = mountNestedList({
				root: scope,
				at: 2,
				children: [makePara('n0\n'), makePara('n1\n'), makePara('n2\n')],
				ids: ['n0', 'n1', 'n2'],
				oracle: heightsOracle({ n0: 10, n1: 10, n2: 10 }),
				listHeight: 30
			});
			scope.port.setScrollTop(45);
			const growInner = await growOnResize(nested.windowing, 'n0', 0, 10, 10 + GROWTH);
			const growHost = await growOnResize(scope.windowing, 'b2', 2, 30, 30 + GROWTH);
			const writes = [vi.spyOn(scope.port, 'scrollBy'), vi.spyOn(scope.port, 'setScrollTop')];

			growInner();
			growHost();
			await tick();

			expect(writes.map((w) => w.mock.calls.length)).toEqual([1, 0]);
			expect(scope.port.scrollTop()).toBe(45 + GROWTH);
			nested.cleanup();
			scope.cleanup();
		});
	}
});
