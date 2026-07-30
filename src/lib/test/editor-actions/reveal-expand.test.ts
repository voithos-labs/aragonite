// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';
import { createSelectionState } from '$lib/selection/selection-state.svelte';

// The reveal seam's expansion decision: a reveal aimed at a body child of a COLLAPSED
// container opens its expand door first, so the descent below runs against the
// post-expansion window instead of dead-ending on the clamp. The door itself (which
// patch, whose commit, the reading-mode gate) is composed one layer up and pinned in
// `test/plugins/expand-door.test.ts`; here only the decision and its ordering.

function makeRef(): BlockComponent {
	return { focus: vi.fn(), getCursorOffset: vi.fn(() => null), editable: true, focusable: true };
}

function node(childCount: number): CstNode {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: { ordered: false },
		children: Array.from({ length: childCount }, () => ({
			kind: 'paragraph' as const,
			leadingTrivia: '',
			raw: 'text\n'
		}))
	};
}

function shim(over: {
	refs: (BlockComponent | undefined)[];
	isCollapsed?: () => boolean;
	expandCollapsed?: () => Promise<boolean>;
}): BlockComponent {
	return createContainerBlockComponent({
		selection: createSelectionState(),
		get innerBlockRefs() {
			return over.refs;
		},
		get nodeChildrenLength() {
			return over.refs.length;
		},
		get node() {
			return node(over.refs.length);
		},
		isCollapsed: over.isCollapsed,
		expandCollapsed: over.expandCollapsed
	});
}

describe('revealByPath — expanding a collapsed container', () => {
	it('opens the door for a body target and resolves the child the expansion mounted', async () => {
		const body = makeRef();
		const refs: (BlockComponent | undefined)[] = [makeRef(), undefined];
		// The clamp is what left slot 1 empty; committing the expansion is what fills it.
		// Awaiting the door before reading the slot is the whole ordering contract.
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

	it('leaves the chrome row alone — child 0 stays mounted while collapsed', async () => {
		const chrome = makeRef();
		const expandCollapsed = vi.fn(async () => true);

		const resolved = await shim({
			refs: [chrome],
			isCollapsed: () => true,
			expandCollapsed
		}).revealByPath!([0]);

		expect(expandCollapsed).not.toHaveBeenCalled();
		expect(resolved).toBe(chrome);
	});

	it('does not open the door for an already-open container', async () => {
		const expandCollapsed = vi.fn(async () => true);
		const refs = [makeRef(), makeRef()];

		await shim({ refs, isCollapsed: () => false, expandCollapsed }).revealByPath!([1]);

		expect(expandCollapsed).not.toHaveBeenCalled();
	});

	// The honest-boolean floor: a collapsible kind that declares no expand door reveals
	// exactly as it did before the door existed — the target stays unmounted, no throw.
	it('degrades when the kind declares no door', async () => {
		const resolved = await shim({
			refs: [makeRef(), undefined],
			isCollapsed: () => true
		}).revealByPath!([1]);

		expect(resolved).toBeNull();
	});

	it('expands every collapsed ancestor on the path, outermost first', async () => {
		const order: string[] = [];
		const target = makeRef();
		const innerRefs: (BlockComponent | undefined)[] = [makeRef(), undefined];
		const inner = shim({
			refs: innerRefs,
			isCollapsed: () => true,
			expandCollapsed: async () => {
				order.push('inner');
				innerRefs[1] = target;
				return true;
			}
		});
		const outerRefs: (BlockComponent | undefined)[] = [makeRef(), undefined];
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
