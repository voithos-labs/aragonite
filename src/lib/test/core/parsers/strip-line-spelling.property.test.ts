// A quote's or list item's line syntax answers "is this line the spelling of that text" without
// reading the line; a yes must be what reading it gives, or a rebuild keeps bytes that read as
// other text.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { quoteLines } from '$lib/core/parsers/blockquote';
import { listItemLines } from '$lib/core/parsers/list';
import { FIRST_LINE, INNER_LINE, type LineCodec, type LinePlace } from '$lib/core/strip-lines';
import { freshOrFixedSeed } from '../../invariants/arbitraries';

const PARAMS = { numRuns: 2000, seed: freshOrFixedSeed(626262) } as const;

const CODECS: [string, LineCodec][] = [
	['quote', quoteLines],
	['bullet item', listItemLines({ indent: '', marker: '- ', taskMarker: null })],
	['wide ordered item', listItemLines({ indent: ' ', marker: '10. ', taskMarker: null })],
	['tab-gapped item', listItemLines({ indent: '', marker: '-\t', taskMarker: null })],
	['to-do', listItemLines({ indent: '', marker: '* ', taskMarker: '[ ] ' })]
];

const PLACES: LinePlace[] = [FIRST_LINE, INNER_LINE, { first: false, trailingBlank: true }];

const arbText = fc
	.array(fc.constantFrom(' ', '\t', '>', '-', '*', '1.', '[ ] ', 'a', 'x y'), { maxLength: 5 })
	.map((units) => units.join(''));

describe('a line syntax spelling a text', () => {
	for (const [name, codec] of CODECS) {
		it(`is a reading of the line, for a ${name}`, () => {
			// The line is the text's own spelling at some place, that spelling with one byte of its
			// prefix swapped, or any line at all.
			const arbCase = fc
				.tuple(arbText, fc.constantFrom(...PLACES), fc.constantFrom(...PLACES), arbText)
				.chain(([text, place, writtenAt, other]) => {
					const spelled = codec.write(text, writtenAt);
					const prefix = spelled.length - text.length;
					const swapped = fc
						.tuple(fc.nat({ max: Math.max(0, prefix - 1) }), fc.constantFrom(' ', '\t', '>', 'a'))
						.map(([at, byte]) => spelled.slice(0, at) + byte + spelled.slice(at + 1));
					return fc
						.oneof(fc.constant(spelled), swapped, fc.constant(other))
						.map((line) => ({ line, text, place }));
				});
			fc.assert(
				fc.property(arbCase, ({ line, text, place }) => {
					if (!codec.spells(line, text, place)) return;
					expect(codec.read(line, place)).toMatchObject({ text, lazy: false });
				}),
				PARAMS
			);
		});

		it(`recognizes its own spelling of plain text, for a ${name}`, () => {
			for (const text of ['a', 'x y', '> q', '- n', '']) {
				expect(codec.spells(codec.write(text, INNER_LINE), text, INNER_LINE)).toBe(true);
			}
		});
	}
});
