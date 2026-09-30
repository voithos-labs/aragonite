// A same-kind text write through `commitLeafText` reports no structural change, so it names the
// leaf it wrote for the commit's stale-raw check, or a stale leaf would go unchecked.
// Miss-analysis: no row drove a same-kind write through the commit.
import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createTopLevelScope } from '$lib/editor-actions/block-edit-scope';
import { commitLeafText } from '$lib/editor-actions/block-edit-core';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

describe('commitLeafText names the leaf it wrote', () => {
	it('hands the commit the written copy of a same-kind leaf', async () => {
		const { deps } = makeEditorActionsDeps('one\n\ntwo\n');
		const controller = createUndoController(deps);
		const commit = vi.spyOn(controller, 'commitStructural');
		const scope = createTopLevelScope(deps, controller);
		const before = deps.doc.children[1];

		const write = legalizeWrite(scope.target(), 1, 'twox\n', 'authored');
		await commitLeafText(scope, 1, write, { snapshotOffset: 3, caret: 4 });

		const written = deps.doc.children[1];
		expect(written.raw).toBe('twox\n');
		expect(written).not.toBe(before);
		const touched = commit.mock.calls[0][0].touchedNodes;
		expect(touched).toHaveLength(1);
		expect(touched![0]).toBe(written);
	});
});
