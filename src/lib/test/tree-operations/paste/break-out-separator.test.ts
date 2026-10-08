// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { makeEditorActionsDeps, pasteContext } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged, triviaRawOf } from '#lib/test/harness/parse-converged.js';

// A break-out keeps the list's separating line (`docs/design/syntax-tree.md` § Blank lines).
// Miss-analysis: `list-break-out.test.ts` never drew a list with a blank line above it.

/** Paste `clipboard` at `offset` inside the leaf at `targetPath` of a live document. */
async function pasteInto(doc: Document, targetPath: number[], offset: number, clipboard: string) {
	const { deps } = makeEditorActionsDeps(doc.children);
	const controller = createUndoController(deps);

	await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(deps, controller)
		})
	);
	return deps.doc;
}

const layout = (doc: Document) => triviaRawOf(doc.children);

describe('a paste that breaks a list out settles the slot it spliced', () => {
	it('keeps the separating line the broken-out list stood below', async () => {
		const pasted = await pasteInto(parse('intro\n\n- one\n- two\n'), [1, 1, 0], 3, '1. x\n');

		expect(serialize(pasted)).toContain('intro\n\n- one\n');
		expectParseConverged(pasted);
	});

	it('keeps the line when the break-out consumes the whole first half', async () => {
		const pasted = await pasteInto(parse('intro\n\n- one\n'), [1, 0, 0], 0, '1. x\n');

		expect(serialize(pasted)).toContain('intro\n\n');
		expectParseConverged(pasted);
	});

	// A blank block above the list is the list's separating line, so the list carries none and
	// the splice must not create one either.
	it('creates nothing below a blank block the run already answers for', async () => {
		const doc = parse('intro\n\n\n- one\n- two\n');
		expect(layout(doc)).toEqual([
			['', 'intro\n'],
			['\n', '\n'],
			['', '- one\n- two\n']
		]);

		const pasted = await pasteInto(doc, [2, 1, 0], 3, '1. x\n');

		expect(serialize(pasted)).toContain('intro\n\n\n- one\n');
		expectParseConverged(pasted);
	});
});
