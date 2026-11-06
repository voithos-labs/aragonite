// @vitest-environment jsdom
// Every class of known law 3 residue still breaks law 3 on its repro, and is the class that repro
// falls under; a class whose repro passes has been fixed, and its row goes.

import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { KNOWN_RESIDUE, knownResidue } from './known-residue';
import { cutPasteBack, type Call } from './laws';
import { checkHost } from './test-host';

describe('the known law 3 residue', () => {
	for (const known of KNOWN_RESIDUE) {
		it(known.gap, () => {
			const host = checkHost();
			const call: Call = (source, range, gesture, mode) =>
				editRange(source, range, gesture, mode, host);
			const { source, mode, range } = known.repro;
			expect(cutPasteBack(call, host, known.repro)).not.toEqual([]);
			expect(knownResidue(host, source, range)?.gap).toBe(known.gap);
			void mode;
		});
	}
});
