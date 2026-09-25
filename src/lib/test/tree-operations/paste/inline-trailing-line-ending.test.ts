// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, pasteContext } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// A one-paragraph clipboard pastes inline, its line breaks landing as the paragraph's own. A
// break at the clipboard's end that would meet the end of a line breaks nothing, and kept, it
// left the paragraph holding a blank line the reload reads as a block (GH #442).
// Miss-analysis: the inline pins pasted clipboards ending in content or in a whole blank line,
// so a single trailing line ending, what copying one line usually gives, was never pasted.

beforeEach(() => __resetSchemaRegistriesForTests());

async function paste(source: string, offset: number, clipboard: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(deps);
	const result = await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0], offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
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
