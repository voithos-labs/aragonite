/**
 * Type pins for the freeze-surface liveness rule (docs/roadmap.md § Pre-1.0 item 1):
 * a live field on the public factory-deps interfaces is a thunk (`() => T`), so a
 * captured value no longer compiles. The `@ts-expect-error` directives ARE the
 * assertions — `npm run check` fails the day one starts compiling. `valueCaptureRejected`
 * is the load-bearing one: a getter and a value property are structurally identical,
 * so nothing but the thunk shape can reject a value capture.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import type { ContainerBlockDeps } from '$lib/editor-actions/plugin/container';
import type { EditableLeafDeps } from '$lib/components/blocks/editable-leaf';

// Load-bearing: a value under the CORRECT new name. Fails only because `NodeView` is
// not `() => NodeView` — value-capture of a live field, now uncompilable.
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

// The pre-freeze getter shape (`get node()`) is gone — the field is named `getNode`.
export function getterShapeRejected(view: NodeView): void {
	const container: ContainerBlockDeps = {
		getNode: () => view,
		getIndex: () => 0,
		getPath: () => [],
		getBoxEl: () => undefined,
		// @ts-expect-error `node` is not a ContainerBlockDeps field — the getter convention is retired
		get node() {
			return view;
		}
	};
	void container;
}

// The pre-freeze value shape (`node: someView`) is gone for the same reason.
export function valueShapeRejected(view: NodeView): void {
	const leaf: EditableLeafDeps = {
		getNode: () => view,
		getIndex: () => 0,
		getPath: () => [],
		getEl: () => null,
		// @ts-expect-error `node` is not an EditableLeafDeps field — pass getNode instead
		node: view
	};
	void leaf;
}

describe('factory deps liveness — thunk shape (freeze surface)', () => {
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
