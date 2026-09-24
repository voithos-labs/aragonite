// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { __getDefaultTextSurface } from '$lib/tree-operations/paste/hooks';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// Miss-analysis: no paste test filled one empty paragraph of a run of two, so a clipboard block
// with no line ending that took the other one's line as its own went unseen.

beforeEach(() => {
	__resetPasteSurfacesForTests();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
});

async function pasteOnFirstEmptyLine(source: string, markdown: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	await pasteDispatch(
		{ pastedText: markdown, targetPath: [1], offset: 0 },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			undoEntry: 'own'
		})
	);
	return deps.doc;
}

describe('blocks pasted onto an empty line between two paragraphs', () => {
	it.each([
		['a quote with no line ending', '> q', 'a\n\n> q\n\nb\n'],
		['a quote with a line ending', '> q\n', 'a\n\n> q\n\nb\n'],
		['two paragraphs', 'x\n\ny', 'a\n\nx\n\ny\n\nb\n']
	])('%s keeps one blank line before the next paragraph', async (_, markdown, after) => {
		const doc = await pasteOnFirstEmptyLine('a\n\n\nb\n', markdown);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('blocks pasted onto the first of two empty lines', () => {
	it.each([
		['a quote with no line ending', '> q', 'a\n\n> q\n\n\nb\n'],
		['a quote with a line ending', '> q\n', 'a\n\n> q\n\n\nb\n'],
		['two paragraphs', 'x\n\ny', 'a\n\nx\n\ny\n\n\nb\n']
	])('%s leaves the second empty line standing', async (_, markdown, after) => {
		const doc = await pasteOnFirstEmptyLine('a\n\n\n\nb\n', markdown);

		expect(serialize(doc)).toBe(after);
		expect(doc.children.map((c) => c.raw)).toContain('\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
