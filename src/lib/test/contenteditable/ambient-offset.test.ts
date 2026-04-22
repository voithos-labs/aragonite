// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { domToRawOffset, rawToDomOffset } from '../../contenteditable/ambient-offset';

describe('ambient-offset translation', () => {
	describe('domToRawOffset', () => {
		it('is identity when ambientLength is 0', () => {
			expect(domToRawOffset(0, 0)).toBe(0);
			expect(domToRawOffset(5, 0)).toBe(5);
		});

		it('subtracts ambient length from DOM offset', () => {
			expect(domToRawOffset(5, 2)).toBe(3);
			expect(domToRawOffset(2, 2)).toBe(0);
		});

		it('clamps to 0 when DOM offset is inside the ambient region', () => {
			expect(domToRawOffset(0, 2)).toBe(0);
			expect(domToRawOffset(1, 2)).toBe(0);
		});
	});

	describe('rawToDomOffset', () => {
		it('is identity when ambientLength is 0', () => {
			expect(rawToDomOffset(0, 0)).toBe(0);
			expect(rawToDomOffset(5, 0)).toBe(5);
		});

		it('adds ambient length to raw offset', () => {
			expect(rawToDomOffset(0, 2)).toBe(2);
			expect(rawToDomOffset(3, 2)).toBe(5);
		});
	});

	describe('round-trip', () => {
		it('raw -> dom -> raw preserves original for any rawOffset >= 0', () => {
			for (const ambient of [0, 2, 6]) {
				for (const raw of [0, 1, 5, 10]) {
					expect(domToRawOffset(rawToDomOffset(raw, ambient), ambient)).toBe(raw);
				}
			}
		});
	});
});
