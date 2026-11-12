// @vitest-environment jsdom
// Every place a removal's answer names is read on the bytes after it: the parent of a caret held
// as a block or a boundary, and of the place the block the range started in stood, is the document
// or a container of the answer's bytes that holds the place's byte. A path the core read before
// the removal names some other block once a commit moves the blocks above it.
// Miss-analysis: the core handed the block it took by its path before the removal, and no row
// asked a path in the answer of the bytes the answer wrote.

import { describe, expect, it } from 'vitest';
import { removalOf, type RemovalGesture } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import fc from 'fast-check';
import { arbLawDocument, arbNeighbourDocument } from '../range-laws/shapes';
import { lawInputs } from './inputs';
import { testReading } from './test-host';

const DOCUMENTS = process.env.RANGE_EDIT_FULL === '1' ? 600 : 120;
const SEED = freshOrFixedSeed(20261112);
// The law documents bring nested containers a removal ends; the neighbours bring taken blocks.
const DOCUMENTS_DRAWN = fc.oneof(arbLawDocument, arbNeighbourDocument);
const GESTURES: RemovalGesture[] = ['backspace', 'delete', 'cut', 'type', 'compose', 'command'];

describe('a removal names its places on the bytes it leaves', () => {
	it(`over ${DOCUMENTS} drawn documents, seed ${SEED}`, () => {
		const reading = testReading();
		const host = rangeHost(reading);
		const fails: string[] = [];
		let taken = 0;
		for (const input of lawInputs(DOCUMENTS, SEED, reading.grammar, DOCUMENTS_DRAWN))
			for (const range of input.ranges)
				for (const gesture of GESTURES) {
					const answer = removalOf(input.source, range, gesture, input.mode, host);
					const layout = documentLayout(measured(host.read(answer.source)));
					const places = [
						answer.caret.holds === 'text' ? null : answer.caret,
						answer.taken ?? null
					].filter((place) => place !== null);
					if (answer.taken) taken++;
					for (const { at, parent } of places) {
						const block = parent.length === 0 ? null : layout.block(parent);
						const holds =
							parent.length === 0 || (!!block && !block.text && block.from <= at && at <= block.to);
						if (!holds)
							fails.push(
								`[${parent}] at ${at}: ${JSON.stringify([input.source, range, gesture, input.mode])}`
							);
					}
				}
		expect(fails.slice(0, 8)).toEqual([]);
		expect(taken, 'draws whose removal took the block the range started in').toBeGreaterThan(20);
	});

	// The table the range starts among the rows of ends before the byte once its rows are gone.
	it('names the taken place among a quote, not the table the range left', () => {
		const source = 'abc\n\n> | a |\n> |---|\n> | 1 |\n> | 2 |\n\n# h\n';
		const range = { from: source.indexOf('| 1 |'), to: source.indexOf('# h') };
		const answer = removalOf(source, range, 'type', 'source', rangeHost(testReading()));
		expect(answer.source).toBe('abc\n\n> | a |\n> |---|\n> \n# h\n');
		expect(answer.taken).toEqual({ at: range.from, parent: [1] });
	});
});
