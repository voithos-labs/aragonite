/**
 * G4.366: which marker sides pair, and so which a removal puts back and which a range carries off,
 * is answered in one file, the live join. A second reader of a side's pair would drift from it.
 */

import { describe, expect, it } from 'vitest';
import { collectEditorSources } from './scan-source';

const HOME = 'src/lib/core/inline/live-edit/live-join.ts';

/** A read of a policy row's pair: which pair a side opens or closes, or the key it pairs by, as
 *  a member of `pair` or destructured out of it. */
const PAIR_READ =
	/\bpair[?!]?\.(?:of|opens|key)\b|\{[^{}]*\b(?:of|opens|key)\b[^{}]*\}\s*=[^;\n]*\bpair\b/;

const readers = collectEditorSources()
	.filter((file) => PAIR_READ.test(file.code))
	.map((file) => file.relPath);

describe('G4.366 marker sides pair in the live join alone', () => {
	it('the scan sees a read of a side’s pair', () => {
		expect(PAIR_READ.test('if (side.pair?.opens) push(side);')).toBe(true);
		expect(PAIR_READ.test('const key = row.pair.key;')).toBe(true);
		expect(PAIR_READ.test('return row.pair!.of;')).toBe(true);
		expect(PAIR_READ.test('const { opens } = policyOf(kind)!.pair!;')).toBe(true);
		expect(PAIR_READ.test('readonly pair: boolean; making.pair')).toBe(false);
	});

	it('only the live join reads one', () => {
		expect(readers).toEqual([HOME]);
	});
});
