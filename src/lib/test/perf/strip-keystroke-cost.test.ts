// A keystroke in one child of a long quote reads that child's lines alone, and a lazy line beside
// the typing costs no parse.
// Miss-analysis: the keystroke cost tests counted rebuild depth and re-reads, never how many lines
// a rebuild read, so a rebuild that walked every line of its container per key passed them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

const TARGET = 1250;

/** A 5,000-line quote of one-line paragraphs, written with no space after the markers; the target
 *  paragraph continues on a lazy line. */
function longQuote(lazy: boolean): string {
	return Array.from({ length: 2500 }, (_, i) =>
		i === TARGET && lazy ? `>line ${i}\nlazy ${i}\n>\n` : `>line ${i}\n>\n`
	).join('');
}

/** `Q` typed at the end of the target paragraph's first line, twice, through the keystroke's route;
 *  only the second is counted, since the first after a load writes every line's region down. */
function typeTwice(source: string): CstNode {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const leaf = [0, TARGET];
	for (let n = 0; n < 2; n++) {
		if (n === 1) {
			resetPerfInstruments();
			enablePerfInstruments();
		}
		const owner = blockNodeAt(deps.doc, [0]) as CstNode;
		const raw = owner.children![TARGET].raw;
		const at = raw.indexOf('\n');
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(body, TARGET, raw.slice(0, at) + 'Q' + raw.slice(at), 'authored');
		expect(typing.writeLeafInPlace(docPathFrom(leaf), write, at + 1).wrote).toBe(true);
	}
	return blockNodeAt(deps.doc, leaf) as CstNode;
}

beforeEach(() => resetPerfInstruments());
afterEach(() => disablePerfInstruments());

describe('a keystroke in a long quote', () => {
	it('reads the edited child’s lines, not the quote’s', () => {
		const leaf = typeTwice(longQuote(false));

		expect(leaf.raw).toBe(`line ${TARGET}QQ\n`);
		// The child's region: the separator line above it and its own line.
		expect(perfSnapshot().stripLinesRead).toBeLessThanOrEqual(4);
	});

	it('parses nothing beyond the leaf beside a lazy line', () => {
		const leaf = typeTwice(longQuote(true));

		expect(leaf.raw).toBe(`line ${TARGET}QQ\nlazy ${TARGET}\n`);
		expect(perfSnapshot().containerKindReparses).toBe(0);
		expect(perfSnapshot().parseBytes).toBeLessThanOrEqual(4 * leaf.raw.length);
	});
});
