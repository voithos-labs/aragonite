// @vitest-environment jsdom
// A scroll into view wins over either rule for holding a block still: both corrections have to
// re-place the target's absolute position after a change, because the browser's own clamping
// outpaces a relative delta while unmounted images still measure about zero.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import type { PlaceBlock } from '../../cursor/scroll-owner';
import type { RootPlacement } from '../../reactivity/use-container-windowing.svelte';
import {
	heightsOracle,
	makePara,
	mountListWindowing,
	type MountListWindowingOptions,
	type MountedListWindowing
} from '../harness/list-windowing.svelte';

const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };

const sixParas = () => [0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`));
const sixIds = () => ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];

const topLevel = (index: number): RootPlacement => ({ index, innerOffset: 0, height: null });

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

describe('list-windowing reveal anchor', () => {
	it('re-places the held target through a structural rebuild', async () => {
		const children = $state(sixParas());
		const ids = $state(sixIds());
		// Where the held block sits now: the rebuild below moves it from index 5 to 4.
		let heldAt = topLevel(5);

		const scope = mountScope({ children, ids, placeTargets: () => heldAt });
		const { windowing, cleanup, port } = scope;

		// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. Put b1 at the top of the viewport, so the
		// block held by default is not the one being scrolled to.
		await windowing.revealChild(1);
		expect(port.scrollTop()).toBe(10);
		hold(scope, [5]);

		// Delete b3, which sits between the held block and the target, so the stable-id rule
		// corrects by zero while the held block slides 40px up. The scroll into view has to win.
		children.splice(3, 1);
		ids.splice(3, 1);
		heldAt = topLevel(4);
		flushSync();

		expect(port.scrollTop()).toBe(110);
		cleanup();
	});

	// Miss-analysis (GH #32): no case drove the subtotal a child reports upward, only corrections.
	describe('growth reported upward by a nested scope', () => {
		// b2 grows from 30 to 130, entirely above the target, so b4's offset moves from 100 to 200.
		const GROW_INDEX = 2;
		const GROWN_TOTAL = 130;
		const TARGET = 4;

		it('re-places the target while a placement holds it', async () => {
			const scope = mountScope();
			await scope.windowing.revealChild(TARGET);
			expect(scope.port.scrollTop()).toBe(100);
			hold(scope, [TARGET]);

			scope.windowing.setChildSubtotal(GROW_INDEX, GROWN_TOTAL);

			expect(scope.port.scrollTop()).toBe(200);
			scope.cleanup();
		});

		it('stays correction-free with nothing held (no cascade up the chain)', async () => {
			const { windowing, cleanup, port } = mountScope();
			await windowing.revealChild(TARGET);

			windowing.setChildSubtotal(GROW_INDEX, GROWN_TOTAL);

			expect(port.scrollTop()).toBe(100);
			cleanup();
		});
	});

	// A target inside a container is not the container: re-placing the ancestor's top pushes
	// the target a container's height out of view on the next measure pass.
	const NESTED = { innerOffset: 35, height: 8 };
	const NESTED_CASES: Array<[PlaceBlock, number, number]> = [
		// b5 lands at 110 after the delete; the target sits 35px into it.
		['nearest', 500, 145],
		// Centred on the target's own box: the ancestor's height of 60 would place it 26px off.
		['center', 100, 145 - (100 - NESTED.height) / 2]
	];
	for (const [block, viewport, expected] of NESTED_CASES) {
		it(`re-places a nested '${block}' target at its own position inside the ancestor`, async () => {
			const children = $state(sixParas());
			const ids = $state(sixIds());
			let heldAt: RootPlacement | null = null;

			const scope = mountScope({
				children,
				ids,
				viewportHeight: viewport,
				listHeight: 80,
				placeTargets: () => heldAt
			});

			await scope.windowing.revealChild(1);
			expect(scope.port.scrollTop()).toBe(10);
			hold(scope, [5, 0], block);

			children.splice(3, 1);
			ids.splice(3, 1);
			heldAt = { index: 4, ...NESTED };
			flushSync();

			expect(scope.port.scrollTop()).toBe(expected);
			scope.cleanup();
		});
	}
});
