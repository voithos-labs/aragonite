// The text blocks a byte range crosses, each once and in order, with the offsets of its part: what
// `view.boxesOf` measures. A quote's markers and a line of its own hold no text of a block.
import { describe, expect, it } from 'vitest';
import { createDocumentRead } from '#lib/editor-actions/commit/document-read.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';

const TEXT = 'intro\n\n> one\n> two\n>\n> three\n\n```\ncode\n```\n\nend\n';

function partsOf(text: string) {
	const view = defaultGrammarView;
	const { doc, resolver, signature } = initDocument(text, view);
	const of = measured(doc);
	const read = createDocumentRead({
		getDoc: () => doc,
		measured: () => of,
		typeOf: (kind) => ({ name: kind, label: kind }),
		reading: { grammar: view, resolver, resolverSignature: signature },
		version: () => 0,
		source: () => text
	});
	return (from: number, to: number) =>
		read
			.leavesIn(from, to)
			.map(({ path, start, end }) => blockNodeAt(doc, path)!.raw.slice(start, end));
}

describe('the text blocks a range crosses', () => {
	it('takes each once and in order, its markers left out', () => {
		const parts = partsOf(TEXT);
		expect(parts(0, TEXT.length)).toEqual([
			'intro\n',
			'one\ntwo\n',
			'three',
			'```\ncode\n```\n',
			'end\n'
		]);
		expect(parts(TEXT.indexOf('ne'), TEXT.indexOf('wo'))).toEqual(['ne\nt']);
	});

	it("steps past a quote's own line to the text after it", () => {
		const parts = partsOf(TEXT);
		expect(parts(TEXT.indexOf('>\n'), TEXT.indexOf('three') + 2)).toEqual(['th']);
	});
});
