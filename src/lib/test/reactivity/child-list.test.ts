// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { BlockComponent } from '#lib/block-component.js';
import { componentAt, descendTo, type ChildList } from '#lib/reactivity/child-list.js';
import { refSlotsOver } from '#lib/reactivity/publish-ref.svelte.js';
import { stubBlockComponent } from '#lib/test/harness/editor-actions.js';

// Every path through the tree the editor walks: a windowed list, a list inside a list, a table's
// rows and a row's cells, and a collapsed body. Each level mounts through its own list.

/** A list of `count` children where only `mounted` start in range; scrolling to a child mounts
 *  the one `make` builds for it a microtask later, as a real flush does. */
function windowedList(
	count: number,
	mounted: number[],
	make: (index: number) => BlockComponent = () => stubBlockComponent(),
	over: Partial<ChildList> = {}
) {
	const refs: (BlockComponent | undefined)[] = [];
	for (const i of mounted) refs[i] = make(i);
	const inRange = new Set(mounted);
	const revealChild = vi.fn(async (index: number) => {
		await Promise.resolve();
		inRange.add(index);
		refs[index] = make(index);
	});
	const list: ChildList = {
		count: () => count,
		refs: refSlotsOver(refs),
		windowing: { revealChild, isInWindow: (index) => inRange.has(index) },
		...over
	};
	return { list, refs, revealChild };
}

/** A block whose children are `list`. */
function holding(list: ChildList): BlockComponent {
	return stubBlockComponent({ childList: () => list });
}

describe('descendTo', () => {
	it('scrolls a windowed-out child into range and returns it once it mounts', async () => {
		const { list, refs, revealChild } = windowedList(40, [0, 1, 2]);

		const found = await descendTo(list, [30]);

		expect(revealChild).toHaveBeenCalledWith(30);
		expect(found).toBe(refs[30]);
	});

	it('gives up, without waiting, when the scroll leaves the child out of range', async () => {
		const { list } = windowedList(40, [0]);
		list.windowing.revealChild = vi.fn(async () => {});

		expect(await descendTo(list, [30])).toBeNull();
	});

	it("mounts each level of a list inside a list through that level's own list", async () => {
		const leaf = stubBlockComponent();
		const item = windowedList(3, [], () => leaf);
		const items = windowedList(20, [0], () => holding(item.list));
		const root = windowedList(10, [0], () => holding(items.list));

		const found = await descendTo(root.list, [7, 12, 2]);

		expect(root.revealChild).toHaveBeenCalledWith(7);
		expect(items.revealChild).toHaveBeenCalledWith(12);
		expect(item.revealChild).toHaveBeenCalledWith(2);
		expect(found).toBe(leaf);
	});

	it('reaches a table cell through the row, asking the row for the column scroll', async () => {
		const cell = stubBlockComponent();
		const bringChildIntoView = vi.fn();
		const cells = windowedList(6, [0, 1, 2, 3, 4, 5], () => cell, { bringChildIntoView });
		const rows = windowedList(50, [0, 1], () => holding(cells.list));
		const root = windowedList(1, [0], () => holding(rows.list));

		const found = await descendTo(root.list, [0, 45, 5]);

		expect(rows.revealChild).toHaveBeenCalledWith(45);
		expect(bringChildIntoView).toHaveBeenCalledWith(5);
		expect(found).toBe(cell);
	});

	describe('a collapsed body', () => {
		function collapsed() {
			const title = stubBlockComponent();
			const body = stubBlockComponent();
			let open = false;
			const openCollapsed = vi.fn(async () => {
				open = true;
				return true;
			});
			const details = windowedList(2, [0], (i) => (i === 0 ? title : body), {
				isCollapsed: () => !open,
				openCollapsed
			});
			// A collapsed list's window holds the title row only, as the real clamp does.
			details.list.windowing.isInWindow = (i) => i === 0 || open;
			const root = windowedList(1, [0], () => holding(details.list));
			return { root: root.list, title, body, openCollapsed };
		}

		it('without `openCollapsed`, stops short of the body and commits nothing', async () => {
			const { root, title, openCollapsed } = collapsed();

			expect(await descendTo(root, [0, 1])).toBeNull();
			expect(openCollapsed).not.toHaveBeenCalled();
			// The title row stays mounted and reachable while the body is hidden.
			expect(await descendTo(root, [0, 0])).toBe(title);
		});

		it('with `openCollapsed`, opens the body and returns the child it mounted', async () => {
			const { root, body, openCollapsed } = collapsed();

			expect(await descendTo(root, [0, 1], { openCollapsed: true })).toBe(body);
			expect(openCollapsed).toHaveBeenCalledTimes(1);
		});
	});

	it('returns null for an empty path or a leaf asked for a child', async () => {
		const { list } = windowedList(2, [0, 1]);

		expect(await descendTo(list, [])).toBeNull();
		expect(await descendTo(list, [0, 0])).toBeNull();
	});
});

describe('componentAt', () => {
	it('reads a mounted descendant and never scrolls an unmounted one in', () => {
		const leaf = stubBlockComponent();
		const inner = windowedList(4, [3], () => leaf);
		const root = windowedList(10, [1], () => holding(inner.list));

		expect(componentAt(root.list, [1, 3])).toBe(leaf);
		expect(componentAt(root.list, [8, 0])).toBeNull();
		expect(root.revealChild).not.toHaveBeenCalled();
	});
});
