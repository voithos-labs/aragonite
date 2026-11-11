// @vitest-environment jsdom
// Every class of known residue still breaks its law on its repro, and is the class that repro falls
// under; a class whose repro passes has been fixed, and its row goes.

import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { KNOWN_RESIDUE, knownResidue, type KnownResidue } from './known-residue';
import {
	cutPasteBack,
	keepsOutside,
	pasteAtCaret,
	pasteAtCutCaret,
	plainPaste,
	type Call
} from './laws';
import { checkHost } from './test-host';

describe('the known residue', () => {
	for (const known of KNOWN_RESIDUE) {
		it(`${known.law}: ${known.gap}`, () => {
			const host = checkHost();
			const call: Call = (source, range, gesture, mode) =>
				editRange(source, range, gesture, mode, host);
			const { repro } = known;
			const drawn = {
				source: repro.source,
				mode: repro.mode,
				at: repro.range.from,
				held: { holds: 'text' as const },
				text: repro.text!
			};
			const broken = {
				L3: () => cutPasteBack(call, host, repro),
				L4: () => keepsOutside(call, host, repro),
				// A range is the cut that leaves the caret; none is a drawn caret, which pastes `text`.
				L9: () =>
					repro.range.from < repro.range.to
						? pasteAtCutCaret(call, host, repro)
						: pasteAtCaret(call, host, drawn),
				L11: () => plainPaste(call, host, drawn)
			}[known.law]();
			expect(broken).not.toEqual([]);
			const { source, range, mode } = known.repro;
			const left = call(source, range, 'cut', mode)?.caret;
			expect(knownResidue(host, source, range, known.law, left)?.gap).toBe(known.gap);
		});
	}
});

// Shapes a fresh seed found breaking law 3, shrunk, each under the class it was declared into.
const FOUND: { name: string; repro: KnownResidue['repro']; gap: string }[] = [
	{
		name: 'a list item cut from its text through an HTML block to the paragraph after it',
		repro: { source: '- b\n\n<!--\na\n-->\nalpha\n', mode: 'live', range: { from: 2, to: 16 } },
		gap: 'a container cut out past its end from past an opening line, or from its first text to or through a block that takes no joined text, nests a second one when pasted back'
	}
];

describe('shapes the draws found, under their class', () => {
	for (const { name, repro, gap } of FOUND) {
		it(name, () => {
			const host = checkHost();
			const call: Call = (source, range, gesture, mode) =>
				editRange(source, range, gesture, mode, host);
			expect(cutPasteBack(call, host, repro)).not.toEqual([]);
			expect(knownResidue(host, repro.source, repro.range)?.gap).toBe(gap);
		});
	}
});
