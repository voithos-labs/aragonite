// Miss-analysis: the rederive gate counted parses per keystroke but never their size, so nothing
// said a list item's re-read stays the size of the item in a long list.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const TARGET = 100;
/** A long list: the target's first line continues on a second, and the item after it holds a
 *  second paragraph. */
const SOURCE = Array.from({ length: 200 }, (_, i) => {
	if (i === TARGET) return '- target\n  more\n';
	if (i === TARGET + 1) return '- other\n\n  second\n\n';
	return `- item ${i}\n`;
}).join('');

/** Each of `raws` written into the leaf at `leaf` through the keystroke's in-place route. */
function typeInPlace(leaf: number[], raws: string[]): CstNode {
	const { deps } = makeEditorActionsDeps(SOURCE);
	const typing = createLeafTyping(deps, createUndoController(deps));
	resetPerfInstruments();
	enablePerfInstruments();
	for (const raw of raws) {
		const owner = blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(body, leaf[leaf.length - 1], raw, 'authored');
		expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
	}
	return blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
}

beforeEach(() => resetPerfInstruments());
afterEach(() => disablePerfInstruments());

describe('a list item re-reads its bytes at the size of the item', () => {
	it('reads only first lines while a keystroke leaves the marker as it was', () => {
		typeInPlace([0, TARGET, 0], ['targetx\nmore\n', 'targetxy\nmore\n']);

		expect(perfSnapshot().containerKindReparses).toBe(0);
	});

	it('reads the item alone, once, for the keystroke that widens its marker', () => {
		const item = typeInPlace([0, TARGET, 0], [' target\nmore\n']);

		expect(item.metadata).toMatchObject({ marker: '-  ' });
		expect(perfSnapshot().containerKindReparses).toBe(1);
		expect(perfSnapshot().containerReparseBytes).toBeLessThanOrEqual(item.raw.length);
	});

	it('reads nothing for a keystroke below the item’s first line', () => {
		typeInPlace([0, TARGET + 1, 1], ['secondx\n', 'secondxy\n']);

		expect(perfSnapshot().containerKindReparses).toBe(0);
		expect(perfSnapshot().openerLineReads).toBe(0);
	});
});
