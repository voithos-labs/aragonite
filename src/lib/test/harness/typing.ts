// A typing session over a document: each call writes one block's bytes through the keystroke route
// and its settle, and fails on a live tree that a reload would read differently.

import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';

export function typingOver(source: string) {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createUndoController(deps);
	const type = (index: number, text: string): string => {
		const write = legalizeWrite(deps.doc, index, text, 'authored', defaultGrammarView);
		expect(typing.typeLeaf(docPathFrom([index]), write, 0).wrote).toBe(true);
		expectParseConverged(deps.doc);
		return serialize(deps.doc);
	};
	return { doc: deps.doc, type };
}
