// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, pasteContext } from '$lib/test/harness/editor-actions';
import { expectParseConverged, triviaRawOf } from '$lib/test/harness/parse-converged';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// A break-out replaces the enclosing list with a first-half list, the pasted blocks and a
// residue half, and the list's own separating line has to survive that swap like every other
// splice's does (syntax-tree.md § Blank lines).
// Miss-analysis: `list-break-out.test.ts` covers the pure replacement builder only, over lists
// drawn with no separator above them, so no case ever put a blank line at the spliced position:
// the one input whose loss the builder's blanket `leadingTrivia: ''` produces.

/** Paste `clipboard` at `offset` inside the leaf at `targetPath` of a live document. */
async function pasteInto(doc: Document, targetPath: number[], offset: number, clipboard: string) {
	__resetSchemaRegistriesForTests();
	const { deps } = makeEditorActionsDeps(doc.children);
	const controller = createUndoController(deps);

	await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
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
