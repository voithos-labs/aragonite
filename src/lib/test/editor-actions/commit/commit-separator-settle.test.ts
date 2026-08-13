import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { asDocPath } from '$lib/selection/path-math';

// The ceremony settles every splice against the pre-mutate children it still holds
// (`tree-operations/node-ops.settleSeparator`). Two contracts the wiring owes.
// Miss-analysis: the settle lived at each splice site, so no case ever asked what a SECOND
// settle over the same window does, nor whether a probe reading post-splice state could still
// see was-blank. Both only became askable when the rule moved into the seam.

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	return { ...harness, controller, actions: createBlockEditActions(harness.deps, controller) };
}

describe('the ceremony settle over a window its mutate already settled', () => {
	it('leaves an emptied block alone rather than settling its run twice', async () => {
		const h = makeTop('alpha\n\nx\n\ndelta\n');

		await h.actions.updateBlockContent(1, '\n');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});

	// A multi-block fill returns a `replace` window covering the filled slot, so the funnel sees
	// the same transition `updateNodeContent` just answered for.
	it('leaves a multi-block fill of a blank slot alone', async () => {
		const h = makeTop('alpha\n\n\ndelta\n');

		await h.actions.updateBlockContent(1, 'p\n\nq\n');

		expect(serialize(h.deps.doc)).toBe('alpha\n\np\n\nq\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});

describe('the ceremony settle reads was-blank off the pre-mutate children', () => {
	it('hands both ends back the line a blank slot was holding for them', async () => {
		const h = makeTop('alpha\n\n\ndelta\n');

		await h.controller.commitStructural({
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: (children) => {
				children.splice(1, 1, ...parse('X\n').children);
				return { op: 'replace', at: 1, count: 1, newCount: 1 };
			}
		});

		expect(serialize(h.deps.doc)).toBe('alpha\n\nX\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});
