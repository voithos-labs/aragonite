/**
 * Type pins for the rule that live fields stay live: a live field on the public factory-deps
 * interfaces is a function (`() => T`), so a captured value no longer compiles. The
 * `@ts-expect-error` directives are the assertions; `npm run check` fails the day one starts
 * compiling. A getter and a value property are structurally identical, so only the function
 * shape can reject a captured value.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import type { ContainerBlockDeps } from '$lib/editor-actions/plugin/container';
import type { EditableLeafDeps } from '$lib/components/blocks/editable-leaf';

// The one that matters: a value under the correct new name. It fails only because `NodeView`
// is not `() => NodeView`, which is a captured live field and no longer compiles.
export function valueCaptureRejected(view: NodeView): void {
	const container: ContainerBlockDeps = {
		// @ts-expect-error getNode is a () => NodeView thunk; a captured value is not a live read
		getNode: view,
		getIndex: () => 0,
		getPath: () => [],
		getBoxEl: () => undefined
	};
	const leaf: EditableLeafDeps = {
		// @ts-expect-error getNode is a () => NodeView thunk; a captured value is not a live read
		getNode: view,
		getIndex: () => 0,
		getPath: () => [],
		getEl: () => null
	};
	void container;
	void leaf;
}

// There is no getter form: the field is named `getNode`.
export function getterShapeRejected(view: NodeView): void {
	const container: ContainerBlockDeps = {
		getNode: () => view,
		getIndex: () => 0,
		getPath: () => [],
		getBoxEl: () => undefined,
		// @ts-expect-error `node` is not a ContainerBlockDeps field; there is no getter form
		get node() {
			return view;
		}
	};
	void container;
}

// There is no plain-value form (`node: someView`) either, for the same reason.
export function valueShapeRejected(view: NodeView): void {
	const leaf: EditableLeafDeps = {
		getNode: () => view,
		getIndex: () => 0,
		getPath: () => [],
		getEl: () => null,
		// @ts-expect-error `node` is not an EditableLeafDeps field; pass getNode instead
		node: view
	};
	void leaf;
}

describe('factory deps liveness: thunk shape (freeze surface)', () => {
	it('accepts the thunk shape and re-reads getNode() live', () => {
		const view = parse('# h\n').children[0];

		const container: ContainerBlockDeps = {
			getNode: () => view,
			getIndex: () => 0,
			getPath: () => [],
			getBoxEl: () => undefined
		};
		expect(container.getNode()).toBe(view);

		const leaf: EditableLeafDeps = {
			getNode: () => view,
			getIndex: () => 0,
			getPath: () => [],
			getEl: () => null
		};
		expect(leaf.getNode()).toBe(view);
	});
});
