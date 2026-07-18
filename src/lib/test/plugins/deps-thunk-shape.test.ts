/**
 * Type pins for the freeze-surface liveness rule (docs/roadmap.md § Pre-1.0 item 1):
 * on the two public factory-deps interfaces a live field is a thunk (`() => T`), so a
 * captured value no longer compiles. The `@ts-expect-error` directives ARE the
 * assertions — `npm run check` fails the day one starts compiling (the directive turns
 * "unused"). The load-bearing pin is `valueCaptureRejected`: it fails ONLY because a
 * value is not `() => T` — the exact value-capture this pass makes unrepresentable
 * (a getter and a value property are structurally identical, so a rename guard alone
 * would not catch it). The pin functions are never invoked; the runtime case proves
 * the thunk shape works and re-reads live.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type { NodeView } from '../../core/node-views';
import type { ContainerBlockDeps } from '../../editor-actions/plugin/container';
import type { EditableLeafDeps } from '../../components/blocks/editable-leaf';

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
