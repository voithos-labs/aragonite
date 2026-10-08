// @vitest-environment jsdom
// Miss-analysis (GH #262): no test called the public `invalidate()` from a commit's `edit` handler.
import { describe, it, expect } from 'vitest';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createDecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import { isCommitInProgress } from '#lib/invariants/commit-scope.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { makeEditorActionsDeps, makeNode } from '#lib/test/harness/editor-actions.js';
import {
	stampStructuralChange,
	type StructuralChange
} from '#lib/tree-operations/structural-change.js';

describe('a source that invalidates from its own edit handler', () => {
	it('runs once, after the commit publishes, never inside it', async () => {
		const { deps, doc } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const engine = createDecorationEngine({ getDoc: () => deps.doc });

		const runs: { inCommit: boolean; blocks: number }[] = [];
		const handle = engine.addSource({
			name: 'probe',
			provide: (d) => {
				runs.push({ inCommit: isCommitInProgress(), blocks: d.children.length });
				return [];
			}
		});

		let runsWhenHandlerReturned = -1;
		deps.events.on('edit', () => {
			handle.invalidate();
			// Two calls inside one commit are one run, not two.
			handle.invalidate();
			runsWhenHandlerReturned = runs.length;
		});

		await controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				children.push({ ...makeNode('paragraph', 'world\n'), leadingTrivia: '\n' });
				const change: StructuralChange = { op: 'insert', at: children.length - 1, count: 1 };
				stampStructuralChange(children, change, deps.sharing);
				return change;
			},
			op: { kind: 'insertBlock', eventPath: asDocPath([1]) }
		});

		// The run from `addSource` and nothing else: the handler's `invalidate` did not run there
		// and then.
		expect(runsWhenHandlerReturned).toBe(1);
		expect(runs).toHaveLength(2);
		expect(runs[1]).toEqual({ inCommit: false, blocks: doc.children.length });
	});

	it('runs inline when no commit is in progress', () => {
		const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const engine = createDecorationEngine({ getDoc: () => deps.doc });
		let runs = 0;
		const handle = engine.addSource({ name: 'probe', provide: () => (runs++, []) });

		handle.invalidate();
		expect(runs).toBe(2);
	});
});
