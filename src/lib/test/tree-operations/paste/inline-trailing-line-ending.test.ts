// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { makeEditorActionsDeps, pasteContext } from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

// A line break ending a one-paragraph clipboard is dropped, or it reloads as a blank block.
// Miss-analysis: GH #442, no inline test pasted a clipboard ending in one line ending.

async function paste(source: string, offset: number, clipboard: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(deps);
	const result = await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0], offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(deps, controller)
		})
	);
	return { doc: deps.doc, caret: result.inlineCaretOffset };
}

describe('a pasted line ending that meets the end of a line', () => {
	it.each([
		['the paragraph end', 'abc\n\nAfter\n', 3, 'x\n', 'abcx\n\nAfter\n'],
		['the document end', 'abc\n', 3, 'x\n', 'abcx\n'],
		['the paragraph end, indented text', 'abc\n\nAfter\n', 3, '  x\n', 'abc  x\n\nAfter\n'],
		['a soft break', 'abc\nAfter\n', 3, 'x\n', 'abcx\nAfter\n'],
		['a heading end', '# abc\n\nAfter\n', 5, 'x\n', '# abcx\n\nAfter\n'],
		['the end of two pasted lines', 'abc\n\nAfter\n', 3, 'x\ny\n', 'abcx\ny\n\nAfter\n']
	])('at %s is dropped', async (_, source, offset, clipboard, expected) => {
		const { doc, caret } = await paste(source, offset, clipboard);

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
		expect(caret).toBe(offset + clipboard.trimEnd().length);
	});
});

describe('the line endings an inline paste keeps', () => {
	it.each([
		['mid-line, as a soft break', 'abc\n\nAfter\n', 1, 'x\n', 'ax\nbc\n\nAfter\n'],
		['a whole blank line, as a block', 'abc\n\nAfter\n', 3, 'x\n\n', 'abcx\n\n\nAfter\n']
	])('%s', async (_, source, offset, clipboard, expected) => {
		const { doc } = await paste(source, offset, clipboard);

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
	});
});
