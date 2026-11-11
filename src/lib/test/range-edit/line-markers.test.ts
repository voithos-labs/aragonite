// Over the built-in grammar and the bundled syntax plugins, the range core's reads of a line's
// markers through the line shapes end where the hand patterns they replaced did, so every
// built-in's bytes stay as they were.
// Miss-analysis: the core read a quote's `>` by hand at eleven places and no test held those reads
// to the line shapes, so a plugin container's own marker read as text there.

import { expect, it } from 'vitest';
import fc from 'fast-check';
import { readDoc } from '#lib/range-edit/document.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { markersOnly } from '#lib/range-edit/markers.js';
import { testReading } from './test-host';

const PIECES = [
	' ',
	'\t',
	'>',
	'> ',
	'>\t',
	'>>',
	'    ',
	'        > ',
	'\r',
	'a',
	'%> ',
	'-',
	'#'
];
const SPACES = ['\n', '\r\n', '\xa0', '\f', '\v', String.fromCharCode(0x2003)];

const arbLine = fc.array(fc.constantFrom(...PIECES), { maxLength: 16 }).map((p) => p.join(''));
const arbText = fc
	.array(fc.constantFrom(...PIECES, ...SPACES), { maxLength: 24 })
	.map((p) => p.join(''));

const sticky = (pattern: RegExp, text: string, at: number) => {
	pattern.lastIndex = at;
	pattern.exec(text);
	return pattern.lastIndex;
};

it('a line’s markers end where a run of spaces, tabs and `>` does, at every offset', () => {
	const host = rangeHost(testReading());
	fc.assert(
		fc.property(arbText, (text) => {
			for (let at = 0; at <= text.length; at++)
				expect(host.pastMarkers(text, at), JSON.stringify([text, at])).toBe(
					sticky(/[ \t>]*/y, text, at)
				);
		}),
		{ numRuns: 400 }
	);
});

it('a line holds markers alone where it holds spaces, tabs and `>` alone', () => {
	const doc = readDoc('', rangeHost(testReading()), 'source');
	fc.assert(
		fc.property(arbText, (text) => {
			for (let at = 0; at <= text.length; at++) {
				const end = text.indexOf('\n', at);
				const line = text.slice(at, end < 0 ? text.length : end);
				expect(markersOnly(doc, text, at), JSON.stringify([text, at])).toBe(
					/^[ \t>]*\r?$/.test(line)
				);
			}
		}),
		{ numRuns: 400 }
	);
});

it('a line is blank inside built-in containers where it holds spaces, tabs and `>` alone', () => {
	const host = rangeHost(testReading());
	const kinds = fc.array(fc.constantFrom('blockquote', 'list', 'listItem'), { maxLength: 4 });
	fc.assert(
		fc.property(kinds, arbLine, (holding, line) => {
			expect(host.blankIn(holding, line), JSON.stringify([holding, line])).toBe(
				/^[ \t>]*$/.test(line)
			);
		}),
		{ numRuns: 1000 }
	);
});
