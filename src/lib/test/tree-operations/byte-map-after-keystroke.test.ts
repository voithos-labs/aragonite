// The byte map answers for the bytes a keystroke left: a commit writes a leaf's raw in place and the
// nodes around it keep their identity, so a map kept past one call would answer for bytes now gone.
// Miss-analysis: every byte map test read a freshly parsed document, never one a commit had written.

import { describe, expect, it } from 'vitest';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { documentLineEnding } from '#lib/core/lines.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import {
	byteOfLeaf,
	documentByteMap,
	leafAtByte,
	leafAtRawOffset,
	rawOffsetOfLeaf
} from '#lib/tree-operations/container-offsets.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

/** Every answer the byte map gives about `doc`, byte by byte and leaf offset by leaf offset. */
function answers(doc: Document, leaf: number[]) {
	const map = documentByteMap(doc);
	const bytes = serialize(doc).length;
	const leafRaw = blockNodeAt(doc, leaf)!.raw;
	const top = doc.children[leaf[0]];
	return Array.from({ length: bytes + 1 }, (_, at) => [
		JSON.stringify(map.leafAt(at)),
		JSON.stringify(leafAtByte(doc, at)),
		JSON.stringify(leafAtRawOffset(top, at))
	]).concat(
		Array.from({ length: leafRaw.length + 1 }, (_, offset) => [
			String(map.byteOf(leaf, offset)),
			String(byteOfLeaf(doc, leaf, offset)),
			String(rawOffsetOfLeaf(top, leaf.slice(1), offset))
		])
	);
}

describe('the byte map after a keystroke', () => {
	it.each([
		{ name: 'a quoted paragraph', source: '> alpha\n> beta\n\nafter\n', leaf: [0, 0] },
		{ name: 'a nested item', source: '- a\n  - bc\n\n    d\n\nafter\n', leaf: [0, 0, 1, 0, 0] },
		{ name: 'a CRLF quote', source: '> one\r\n> two\r\n\r\nafter\r\n', leaf: [0, 0] },
		{ name: 'a tab-indented item', source: '- a\n\t- bc\n\nafter\n', leaf: [0, 0, 1, 0, 0] }
	])('$name answers for the typed bytes', ({ source, leaf }) => {
		const { deps } = makeEditorActionsDeps(source);
		const before = answers(deps.doc, leaf);
		const owner = blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const index = leaf[leaf.length - 1];
		const node = owner.children![index];
		const write = legalizeWrite(body, index, 'xy' + node.raw, 'authored', defaultGrammarView);
		expect(createUndoController(deps).typeLeaf(docPathFrom(leaf), write, 2).wrote).toBe(true);

		const fresh = readAsOpened(serialize(deps.doc), {
			grammar: defaultGrammarView,
			scope: 'document'
		});
		const after = answers(deps.doc, leaf);
		expect(after).not.toEqual(before);
		expect(after).toEqual(answers(fresh, leaf));
	});
});
