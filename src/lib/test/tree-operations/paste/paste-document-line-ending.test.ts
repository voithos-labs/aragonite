// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch, __getDefaultTextSurface } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, pasteContext } from '$lib/test/harness/editor-actions';

// The clipboard arrives as LF, so a paste into a CRLF document wrote its own lines in LF and left
// the document holding both endings (GH #448). The per-route mirror rows are in
// `invariants/crlf-edit-mirror.test.ts`; these pin the choice where one document holds both.
// Miss-analysis: the mirror check compared only the separators a paste created, leaving the
// pasted bytes out on purpose, since the clipboard was LF on both of its runs.

beforeEach(() => {
	__resetPasteSurfacesForTests();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
});

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
	it('writes the ending of the block the caret is in', async () => {
		const doc = 'one\n\ntwo\r\n';

		expect((await paste(doc, [1], 3, 'x\n\ny')).source).toBe('one\n\ntwo\r\n\r\nx\r\n\r\ny\r\n');
		expect((await paste(doc, [0], 3, 'x\n\ny')).source).toBe('one\n\nx\n\ny\n\ntwo\r\n');
	});

	// The caret's line ends in CRLF; the paragraph's first line keeps its own LF.
	it('changes only the line breaks the paste wrote, and moves the caret past them', async () => {
		const { source, caret } = await paste('a\nb\r\n', [0], 3, 'x\ny');

		expect(source).toBe('a\nbx\r\ny\r\n');
		expect(caret).toBe('a\nbx\r\ny'.length);
	});
});
