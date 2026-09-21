// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import type { BlockComponent } from '$lib/block-component';
import { makeShimDeps, mockRef } from '$lib/test/harness/editor-actions';

// A scroll-into-view aimed into a collapsed container expands it first, so the descent
// runs against the expanded tree instead of stopping on the hidden body. The expand itself
// is composed a layer up and tested in `test/plugins/expand-door.test.ts`.

function shim(over: {
	refs: (BlockComponent | undefined)[];
	isCollapsed?: () => boolean;
	expandCollapsed?: () => Promise<boolean>;
}): BlockComponent {
	return createContainerBlockComponent(
		makeShimDeps(over.refs, {
			isCollapsed: over.isCollapsed,
			expandCollapsed: over.expandCollapsed
		})
	);
}

describe('revealByPath, expanding a collapsed container', () => {
	it('opens the entry point for a body target and resolves the child the expansion mounted', async () => {
		const body = mockRef();
		const refs: (BlockComponent | undefined)[] = [mockRef(), undefined];
		// Awaiting the expand before reading the ref is the whole ordering contract.
		const expandCollapsed = vi.fn(async () => {
			refs[1] = body;
			return true;
		});

		const resolved = await shim({ refs, isCollapsed: () => true, expandCollapsed }).revealByPath!([
			1
		]);

		expect(expandCollapsed).toHaveBeenCalledTimes(1);
		expect(resolved).toBe(body);
	});

	it('leaves the chrome row alone: child 0 stays mounted while collapsed', async () => {
		const chrome = mockRef();
		const expandCollapsed = vi.fn(async () => true);

		const resolved = await shim({
			refs: [chrome],
			isCollapsed: () => true,
			expandCollapsed
		}).revealByPath!([0]);

		expect(expandCollapsed).not.toHaveBeenCalled();
		expect(resolved).toBe(chrome);
	});

	it('does not open the entry point for an already-open container', async () => {
		const expandCollapsed = vi.fn(async () => true);
		const refs = [mockRef(), mockRef()];

		await shim({ refs, isCollapsed: () => false, expandCollapsed }).revealByPath!([1]);

		expect(expandCollapsed).not.toHaveBeenCalled();
	});

	// The fallback: a kind declaring no expand scrolls into view as it did before the expand existed.
	it('degrades when the kind declares no entry point', async () => {
		const resolved = await shim({
			refs: [mockRef(), undefined],
			isCollapsed: () => true
		}).revealByPath!([1]);

		expect(resolved).toBeNull();
	});

	it('expands every collapsed ancestor on the path, outermost first', async () => {
		const order: string[] = [];
		const target = mockRef();
		const innerRefs: (BlockComponent | undefined)[] = [mockRef(), undefined];
		const inner = shim({
			refs: innerRefs,
			isCollapsed: () => true,
			expandCollapsed: async () => {
				order.push('inner');
				innerRefs[1] = target;
				return true;
			}
		});
		const outerRefs: (BlockComponent | undefined)[] = [mockRef(), undefined];
		const outer = shim({
			refs: outerRefs,
			isCollapsed: () => true,
			expandCollapsed: async () => {
				order.push('outer');
				outerRefs[1] = inner;
				return true;
			}
		});

		const resolved = await outer.revealByPath!([1, 1]);

		expect(order).toEqual(['outer', 'inner']);
		expect(resolved).toBe(target);
	});
});
