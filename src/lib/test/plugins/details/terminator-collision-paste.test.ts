// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, type CstNode } from '#lib';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import { registerDetailsPageWide } from '#lib/test/harness/registered-details.js';
import { makeBlockListState, makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

// Miss-analysis: no test pasted into a bodyWrite container, only typed, split or deleted (GH #40).
// The paste itself is `e2e/tests/plugins/details-terminator-paste.spec.ts`.

const OPEN_DETAILS = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

beforeEach(() => {
	registerDetailsPageWide();
});

function mountDoc(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
	const container = harness.deps.doc.children[0];
	if (container.children) {
		registerBlockListState(
			container,
			makeBlockListState(() => harness.deps.doc.children[0])
		);
	}
	return { ...harness, controller };
}

describe('details terminator escape where pasted blocks are written', () => {
	it('the splice sink escapes an htmlBlock terminator and re-derives its kind', async () => {
		const h = mountDoc(OPEN_DETAILS);

		await h.controller.replaceBlock(
			[0, 1],
			[{ kind: 'htmlBlock', leadingTrivia: '', raw: '</details>\n' } as CstNode],
			{ replacementIndex: 0, offset: 0 },
			{ snapshotOffset: 0 }
		);

		const child = h.doc.children[0].children?.[1];
		expect(child?.raw).toBe('&lt;/details>\n');
		expect(child?.kind).toBe('paragraph');
	});
});
