// @vitest-environment jsdom
// Every class of known residue still breaks its law on its repro, and is the class that repro falls
// under; a class whose repro passes has been fixed, and its row goes.

import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { KNOWN_RESIDUE, knownResidue } from './known-residue';
import { cutPasteBack, keepsOutside, pasteAtCutCaret, type Call } from './laws';
import { checkHost } from './test-host';

describe('the known residue', () => {
	for (const known of KNOWN_RESIDUE) {
		it(`${known.law}: ${known.gap}`, () => {
			const host = checkHost();
			const call: Call = (source, range, gesture, mode) =>
				editRange(source, range, gesture, mode, host);
			const broken = {
				L3: () => cutPasteBack(call, host, known.repro),
				L4: () => keepsOutside(call, host, known.repro),
				L9: () => pasteAtCutCaret(call, host, known.repro)
			}[known.law]();
			expect(broken).not.toEqual([]);
			const { source, range } = known.repro;
			expect(knownResidue(host, source, range, known.law)?.gap).toBe(known.gap);
		});
	}
});
