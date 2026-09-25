// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import {
	makePasteCommit,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { buildListBreakOutReplacement } from '$lib/tree-operations/paste/list-break-out';
import type { Document } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

// A paste that splits a list item gives the text after the caret an item of its own, whose first
// block sits on the new marker line. Indented code there reads as a wider marker, so the reload
// read another item than the editor held (GH #446).
// Miss-analysis: every split-item fixture put a paragraph after the caret, the one kind that
// always reads the same on a marker line; no fixture continued the item with an indented line.

beforeEach(() => __resetSchemaRegistriesForTests());

async function pasteAfterAbc(source: string, clipboard: string) {
	const { doc, controller } = makePasteCommit(source);
	registerStubBlockListState(doc.children[0]);
	await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0, 0, 0], offset: 'abc'.length },
		pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller })
	);
	return doc;
}

describe('the text after the caret, split into an item of its own', () => {
	it.each([
		[
			'an indented line continuing the paragraph',
			'- abc\n      code\n  more\n',
			'- one\n- two',
			'- abc\n- one\n- two\n- \n      code\n  more\n'
		],
		[
			'indented code after a blank line',
			'- abc\n\n      code\n',
			'- one\n- two',
			'- abc\n- one\n- two\n- \n      code\n'
		],
		// `- ---` is a thematic break of its own, which ends the list.
		[
			'a thematic break drawn in dashes',
			'- abc\n\n  ---\n',
			'- one\n- two',
			'- abc\n- one\n- two\n- \n  ---\n'
		]
	])('opens on the line after an empty marker: %s', async (_, source, clipboard, expected) => {
		const doc = await pasteAfterAbc(source, clipboard);

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The break-out route splits the item the same way, into the second half of the list.
	it('opens on the line after an empty marker when the list breaks out', () => {
		const list = parse('1. abc\n       code\n').children[0];
		const pasted = parse('- x\n').children;
		const { replacement } = buildListBreakOutReplacement(list, 0, 0, 3, pasted, '\n');
		const secondHalf = replacement[replacement.length - 1];
		const alone: Document = { kind: 'document', prefix: '', children: [secondHalf], suffix: '' };

		expect(secondHalf.raw).toBe('2. \n       code\n');
		expect(describeConvergence(alone)).toBeNull();
	});

	it.each([
		[
			'a fenced code block',
			'- abc\n  ```\n  x\n  ```\n',
			'- abc\n- one\n- two\n- ```\n  x\n  ```\n'
		],
		['a heading', '- abc\n  # h\n', '- abc\n- one\n- two\n- # h\n']
	])('keeps %s on the marker line, where it reads the same', async (_, source, expected) => {
		const doc = await pasteAfterAbc(source, '- one\n- two');

		expect(serialize(doc)).toBe(expected);
		expect(describeConvergence(doc)).toBeNull();
	});
});
