// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '#lib/editor-actions/container-block-component.js';
import type { BlockComponent } from '#lib/block-component.js';
import { descendTo, type ChildList } from '#lib/block-lists/child-list.js';
import {
	makeShimChildList,
	makeShimDeps,
	stubBlockComponent
} from '#lib/test/harness/editor-actions.js';

// A navigation aimed into a collapsed container opens it first, so the descent runs against the
// opened tree; `test/plugins/expand-door.test.ts` covers the open itself.

function container(
	refs: (BlockComponent | undefined)[],
	over: Partial<ChildList> = {}
): BlockComponent {
	return createContainerBlockComponent(
		makeShimDeps(refs, { childList: makeShimChildList(refs, over) })
	);
}

/** A root list holding one block, the container under test. */
const rootHolding = (block: BlockComponent): ChildList => makeShimChildList([block]);

describe('descendTo, opening a collapsed container', () => {
	it('opens the body for a body target and resolves the child the open mounted', async () => {
		const body = stubBlockComponent();
		const refs: (BlockComponent | undefined)[] = [stubBlockComponent(), undefined];
		// Awaiting the open before reading the ref is the whole ordering contract.
		const openCollapsed = vi.fn(async () => {
			refs[1] = body;
			return true;
		});
		const root = rootHolding(container(refs, { isCollapsed: () => true, openCollapsed }));

		const resolved = await descendTo(root, [0, 1], { openCollapsed: true });

		expect(openCollapsed).toHaveBeenCalledTimes(1);
		expect(resolved).toBe(body);
	});

	it('never opens it for a descent that did not ask, and stops at the hidden body', async () => {
		const openCollapsed = vi.fn(async () => true);
		const root = rootHolding(
			container([stubBlockComponent(), undefined], { isCollapsed: () => true, openCollapsed })
		);

		expect(await descendTo(root, [0, 1])).toBeNull();
		expect(openCollapsed).not.toHaveBeenCalled();
	});

	it('leaves the title row alone: child 0 stays mounted while collapsed', async () => {
		const title = stubBlockComponent();
		const openCollapsed = vi.fn(async () => true);
		const root = rootHolding(container([title], { isCollapsed: () => true, openCollapsed }));

		const resolved = await descendTo(root, [0, 0], { openCollapsed: true });

		expect(openCollapsed).not.toHaveBeenCalled();
		expect(resolved).toBe(title);
	});

	it('does not open an already-open container', async () => {
		const openCollapsed = vi.fn(async () => true);
		const refs = [stubBlockComponent(), stubBlockComponent()];
		const root = rootHolding(container(refs, { isCollapsed: () => false, openCollapsed }));

		await descendTo(root, [0, 1], { openCollapsed: true });

		expect(openCollapsed).not.toHaveBeenCalled();
	});

	// A kind that declares no open gives up with null rather than waiting on the body.
	it('degrades when the kind declares no way to open', async () => {
		const root = rootHolding(
			container([stubBlockComponent(), undefined], { isCollapsed: () => true })
		);

		expect(await descendTo(root, [0, 1], { openCollapsed: true })).toBeNull();
	});

	it('opens every collapsed ancestor on the path, outermost first', async () => {
		const order: string[] = [];
		const target = stubBlockComponent();
		const innerRefs: (BlockComponent | undefined)[] = [stubBlockComponent(), undefined];
		const inner = container(innerRefs, {
			isCollapsed: () => true,
			openCollapsed: async () => {
				order.push('inner');
				innerRefs[1] = target;
				return true;
			}
		});
		const outerRefs: (BlockComponent | undefined)[] = [stubBlockComponent(), undefined];
		const outer = container(outerRefs, {
			isCollapsed: () => true,
			openCollapsed: async () => {
				order.push('outer');
				outerRefs[1] = inner;
				return true;
			}
		});

		const resolved = await descendTo(rootHolding(outer), [0, 1, 1], { openCollapsed: true });

		expect(order).toEqual(['outer', 'inner']);
		expect(resolved).toBe(target);
	});
});
