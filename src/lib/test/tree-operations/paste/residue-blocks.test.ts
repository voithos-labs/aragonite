// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext,
	registerStubBlockListState
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// The text after the caret is every block it parses to, with the break a line-end caret leaves.
// Miss-analysis: GH #436, every residue test cut a one-line leaf, and the shortened tree converged.

beforeEach(() => __resetSchemaRegistriesForTests());

async function paste(source: string, targetPath: number[], offset: number, clipboard: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	// Every container on the path stands for a mounted scope, as it does in the editor.
	let scope = deps.doc.children[targetPath[0]];
	for (const index of targetPath.slice(1)) {
		registerStubBlockListState(scope);
		scope = scope.children![index];
	}
	await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath)
		})
	);
	return deps.doc;
}

describe('a multi-block paste keeps every line after the caret', () => {
	it.each([
		['a soft break', 'abc\nAfter\n', [0], 3, 'x\n\ny', 'abc\n\nx\n\ny\nAfter\n'],
		['a soft break, quote', 'abc\nAfter\n', [0], 3, '> q', 'abc\n\n> q\nAfter\n'],
		[
			'an indented code line',
			'abc\n    code\nmore\n',
			[0],
			3,
			'x\n\ny',
			'abc\n\nx\n\ny\n    code\nmore\n'
		],
		['two lines', 'abc\nAfter\nmore\n', [0], 3, 'x\n\ny', 'abc\n\nx\n\ny\nAfter\nmore\n'],
		['a hard break', 'abc  \nAfter\n', [0], 3, 'x\n\ny', 'abc\n\nx\n\ny  \nAfter\n'],
		// The underline is the title's structure, so it stays on the title, as a split keeps it.
		['a setext underline', 'abc\n---\n', [0], 3, 'x\n\ny', 'abc\n---\n\nx\n\ny\n'],
		['trailing spaces', 'abc  \n', [0], 3, 'x\n\ny', 'abc\n\nx\n\ny\n  \n'],
		['a quote', '> abc\n> After\n', [0, 0], 3, 'x\n\ny', '> abc\n>\n> x\n>\n> y\n> After\n'],
		['a list item', '- abc\n  After\n', [0, 0, 0], 3, 'x\n\ny', '- abc\n\n  x\n\n  y\n  After\n']
	])('at %s', async (_, source, path, offset, clipboard, expected) => {
		const doc = await paste(source, path, offset, clipboard);

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
	});

	it.each([
		['a list', '- abc\n  After\n', '- abc\n- one\n- two\n- After\n'],
		[
			'a list, a heading after the caret',
			'- abc # h\n  more\n',
			'- abc\n- one\n- two\n- # h\n  more\n'
		],
		['an ordered list', '1. abc\n   After\n', '1. abc\n- one\n- two\n2. After\n']
	])('pasting items into %s keeps the rest of the item', async (_, source, expected) => {
		const doc = await paste(source, [0, 0, 0], 3, '- one\n- two');

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
	});
});
