// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, pasteContext } from '$lib/test/harness/editor-actions';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// The clipboard arrives as LF, so a paste into a CRLF document wrote its own lines in LF and left
// the document holding both endings (GH #448). The per-route mirror rows are in
// `invariants/crlf-edit-mirror.test.ts`; these pin the choice where one document holds both.
// Miss-analysis: the mirror check compared only the separators a paste created, leaving the
// pasted bytes out on purpose, since the clipboard was LF on both of its runs.

beforeEach(() => __resetSchemaRegistriesForTests());

async function paste(source: string, targetPath: number[], offset: number, clipboard: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(deps);
	const result = await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
		})
	);
	return { source: serialize(deps.doc), caret: result.inlineCaretOffset };
}

describe('a paste into a document holding both line endings', () => {
	// The document's ending is its first line break, whichever line the caret is on.
	it('writes the pasted lines in the document ending', async () => {
		expect((await paste('one\n\ntwo\r\n', [1], 3, 'x\ny')).source).toBe('one\n\ntwox\ny\r\n');
		expect((await paste('one\r\n\r\ntwo\n', [1], 3, 'x\ny')).source).toBe('one\r\n\r\ntwox\r\ny\n');
	});

	// The document is CRLF; the paragraph's second line keeps its own LF.
	it('changes only the line breaks the paste wrote, and moves the caret past them', async () => {
		const { source, caret } = await paste('a\r\nb\n', [0], 4, 'x\ny');

		expect(source).toBe('a\r\nbx\r\ny\n');
		expect(caret).toBe('a\r\nbx\r\ny'.length);
	});
});
