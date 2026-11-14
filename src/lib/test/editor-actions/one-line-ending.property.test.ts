// @vitest-environment jsdom
// G4.20 over drawn writes: a document that opens with one line ending holds no other after any
// operation of the shared driver, undo and redo among them. G1.117 counts a pair lost; these
// tests also see a lone ending written beside pairs that all stand.
// Miss-analysis: the driver ended a typed block with a hand-written `\n`, the undo property's
// fixed seed drew no typing operation on its one CRLF source, and the kept-bytes property, whose
// seed did, read only its own guard's warnings.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { firstLineEnding, type LineEnding } from '#lib/core/lines.js';
import { lineEndingCounts } from '#lib/core/line-ending-pairs.js';
import { serialize } from '#lib/core/serializer.js';
import { freshOrFixedSeed } from '../invariants/arbitraries';
import { arbOp, arbSource, makeHarness, runOp, type Op } from '../undo/restoration-ops';
import { takeDevWarns } from '../support/warn-gate';

const PARAMS = { numRuns: 60, seed: freshOrFixedSeed(20261114) } as const;

/** How many line endings in `text` are not `ending`. */
function otherEndings(text: string, ending: LineEnding): number {
	const { pairs, loneCr, loneLf } = lineEndingCounts(text);
	return ending === '\r\n' ? loneCr + loneLf : pairs + loneCr;
}

/** Runs `ops`, failing on the first that warns or leaves an ending other than the source's.
 *  Returns the source, then the bytes after each operation. */
async function runKeepingEnding(source: string, ops: readonly Op[]): Promise<string[]> {
	const ending = firstLineEnding(source)!;
	const h = makeHarness(source);
	const states = [source];
	for (const op of ops) {
		await runOp(h, op);
		// Taken before either check can throw, so a failing run leaves no warning for the next.
		const warned = takeDevWarns().map((warn) => `${warn.tag}: ${warn.message}`);
		states.push(serialize(h.deps.doc));
		expect(otherEndings(states.at(-1)!, ending), JSON.stringify(op)).toBe(0);
		expect(warned, JSON.stringify(op)).toEqual([]);
	}
	return states;
}

const LIST = 'lead\r\n\r\n- one\r\n- two\r\n- three\r\n\r\ntail\r\n';
const QUOTE = 'lead\r\n\r\n> quoted\r\n\r\n- x\r\n- y\r\n';
const TABLE = 'intro\r\n\r\n| h1 | h2 |\r\n| --- | --- |\r\n| a | b |\r\n| c | d |\r\n\r\ntail\r\n';

// Keyed by operation, so one added to the driver fails the type check until it has a row.
const ON_CRLF: Record<Op['t'], { source: string; ops: Op[] }> = {
	typeTop: { source: LIST, ops: [{ t: 'typeTop', i: 0, n: 0 }] },
	typeChar: { source: LIST, ops: [{ t: 'typeChar', i: 0, off: 2, ch: 4 }] },
	splitTop: { source: LIST, ops: [{ t: 'splitTop', i: 0, off: 2 }] },
	mergeTopNext: {
		source: LIST,
		ops: [
			{ t: 'splitTop', i: 0, off: 2 },
			{ t: 'mergeTopNext', i: 0 }
		]
	},
	insertItem: { source: LIST, ops: [{ t: 'insertItem', i: 0 }] },
	splitItem: { source: LIST, ops: [{ t: 'splitItem', i: 1, off: 2 }] },
	indent: { source: LIST, ops: [{ t: 'indent', i: 1 }] },
	typeItem: { source: LIST, ops: [{ t: 'typeItem', i: 1, n: 0 }] },
	toggleTask: { source: LIST, ops: [{ t: 'toggleTask', i: 0 }] },
	typeQuote: { source: QUOTE, ops: [{ t: 'typeQuote', i: 0, n: 0 }] },
	tableInsertRow: { source: TABLE, ops: [{ t: 'tableInsertRow', i: 1 }] },
	tableDeleteRow: { source: TABLE, ops: [{ t: 'tableDeleteRow', i: 2 }] },
	tableInsertColumn: { source: TABLE, ops: [{ t: 'tableInsertColumn', i: 0 }] },
	tableDeleteColumn: { source: TABLE, ops: [{ t: 'tableDeleteColumn', i: 1 }] },
	tableReorderRow: { source: TABLE, ops: [{ t: 'tableReorderRow', i: 1, dir: 1 }] },
	tableReorderColumn: { source: TABLE, ops: [{ t: 'tableReorderColumn', i: 0, dir: 1 }] },
	tableCycleAlignment: { source: TABLE, ops: [{ t: 'tableCycleAlignment', i: 0 }] },
	typeCell: { source: TABLE, ops: [{ t: 'typeCell', r: 2, c: 0, n: 0 }] },
	rangeDelete: { source: LIST, ops: [{ t: 'rangeDelete', a: 0, b: 0, off: 2 }] },
	undo: { source: LIST, ops: [{ t: 'typeTop', i: 0, n: 0 }, { t: 'undo' }] },
	redo: { source: LIST, ops: [{ t: 'typeTop', i: 0, n: 0 }, { t: 'undo' }, { t: 'redo' }] }
};

describe('G4.20 a document keeps its one line ending through every drawn write', () => {
	it.each(Object.entries(ON_CRLF))('%s on a CRLF document', async (_, { source, ops }) => {
		const states = await runKeepingEnding(source, ops);
		// An operation that wrote nothing would pass with nothing checked.
		expect(states.at(-1)).not.toBe(states.at(-2));
	});

	it('a letter typed in a paragraph, then an item added to the list below', async () => {
		const states = await runKeepingEnding(LIST, [
			{ t: 'typeChar', i: 0, off: 0, ch: 0 },
			{ t: 'insertItem', i: 0 }
		]);
		expect(states.at(-1)).toBe('|lead\r\n\r\n- one\r\n- \r\n- two\r\n- three\r\n\r\ntail\r\n');
	});

	it('over drawn sources and operations', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbSource,
				fc.array(arbOp, { minLength: 1, maxLength: 12 }),
				async (source, ops) => {
					await runKeepingEnding(source, ops);
				}
			),
			PARAMS
		);
	});
});
