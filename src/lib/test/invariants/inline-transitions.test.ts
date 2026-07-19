import { describe, it, expect } from 'vitest';
import {
	checkPoolBracket,
	checkRevealSourceLength,
	checkCompositionEndPaired,
	type PoolBracketAction
} from '../../invariants/inline-transitions';

describe('checkPoolBracket (G1.25)', () => {
	const cases: Array<[boolean, PoolBracketAction, string | null]> = [
		[false, 'beginPass', null],
		[true, 'acquire', null],
		[true, 'sweep', null],
		[true, 'beginPass', 'begin-unswept'],
		[false, 'acquire', 'acquire-outside-bracket'],
		[false, 'sweep', 'sweep-outside-bracket']
	];

	for (const [passOpen, action, code] of cases) {
		it(`${action} with bracket ${passOpen ? 'open' : 'closed'} → ${code ?? 'legal'}`, () => {
			const violation = checkPoolBracket(passOpen, action);
			if (code === null) expect(violation).toBeNull();
			else expect(violation?.code).toBe(code);
		});
	}
});

describe('checkRevealSourceLength (G1.26 kernel leg)', () => {
	it('accepts a source spanning exactly its range', () => {
		expect(checkRevealSourceLength(5, 2, 7)).toBeNull();
	});

	it('flags a mismatch, carrying the three offsets for the field report', () => {
		const violation = checkRevealSourceLength(4, 2, 7);
		expect(violation?.code).toBe('source-length-mismatch');
		expect(violation?.detail).toEqual({ sourceLength: 4, sourceStart: 2, sourceEnd: 7 });
	});
});

describe('checkCompositionEndPaired (G1.27)', () => {
	it('accepts an end inside an open composition', () => {
		expect(checkCompositionEndPaired(true)).toBeNull();
	});

	it('flags an end with no open composition', () => {
		expect(checkCompositionEndPaired(false)?.code).toBe('end-without-start');
	});
});
