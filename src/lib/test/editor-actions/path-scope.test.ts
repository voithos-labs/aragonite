// The scope a caller holding only a path commits through: the root's at the empty path, a live
// read of the container otherwise, and none where no container stands.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPathScope } from '#lib/editor-actions/block-edit-scope.js';
import { makeBlockListState, makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

function root(source: string) {
	const { deps } = makeEditorActionsDeps(source);
	return { deps, controller: createUndoController(deps) };
}

describe('createPathScope', () => {
	it('is the top-level scope at the empty path', () => {
		const r = root('a\n\nb\n');
		const scope = createPathScope(r, docPathFrom([]))!;

		expect(scope.path).toEqual([]);
		expect(scope.children()).toBe(r.deps.doc.children);
	});

	it('reads the container at the path live, after a commit replaced it', async () => {
		const r = root('- a\n- b\n');
		// Mounted, as a container a caller names by path usually is.
		makeBlockListState(() => r.deps.doc.children[0]);
		const scope = createPathScope(r, docPathFrom([0]))!;
		expect(scope.path).toEqual([0]);

		await scope.commit({
			snapshot: { index: 1, offset: 0 },
			eventTarget: 1,
			op: { kind: 'delete' },
			mutate: (view) => {
				view.body.children.splice(1, 1);
				return { op: 'delete', at: 1, count: 1 };
			}
		});

		expect(serialize(r.deps.doc)).toBe('- a\n');
		expect(scope.children()).toHaveLength(1);
	});

	it.each([
		{ where: 'a leaf', path: [0, 0, 0] },
		{ where: 'nothing', path: [3] }
	])('is null at $where', ({ path }) => {
		expect(createPathScope(root('- a\n'), docPathFrom(path))).toBeNull();
	});
});
