// Miss-analysis: the item reader's rows checked what it read, never how much, so a reader that
// parsed every keystroke's paragraph behind a rebuilt marker line passed them all.
import { describe, it, expect, afterEach } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/cursor/coordinate-spaces.js';
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

const LINES = 400;
const lines = Array.from({ length: LINES }, (_, i) => `line ${i}`);
/** The paragraph's own bytes, and the same bytes indented under a `- ` marker. */
const TEXT = lines.join('\n') + '\n';
const UNDER_ITEM = lines.join('\n  ') + '\n';

/** The bytes one keystroke deep in the leaf at `leaf` makes the parser read. */
function parsedBytesForKeystroke(source: string, leaf: number[]): number {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const owner = blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode;
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
	const raw = TEXT.replace(`line ${LINES - 2}`, `line ${LINES - 2}x`);
	const write = legalizeWrite(body, leaf[leaf.length - 1], raw, 'authored');
	resetPerfInstruments();
	enablePerfInstruments();
	expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
	return perfSnapshot().parseBytes;
}

afterEach(() => disablePerfInstruments());

describe('a keystroke in a list item’s first paragraph', () => {
	it('parses no more than the same keystroke in the item’s second paragraph', () => {
		const first = parsedBytesForKeystroke(`- ${UNDER_ITEM}`, [0, 0, 0]);
		const second = parsedBytesForKeystroke(`- a\n\n  ${UNDER_ITEM}`, [0, 0, 1]);

		expect(second).toBeGreaterThan(0);
		expect(first).toBeLessThanOrEqual(second);
	});
});
