import { describe, expect, it } from 'vitest';
import { spellingRows } from '#packages/spellcheck/src/rows.js';

describe('spellingRows', () => {
	it('lists five suggestions at most, best first, each replacing the word', () => {
		const rows = spellingRows(['a', 'b', 'c', 'd', 'e', 'f', 'g'], false);
		expect(rows.map((row) => row.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(rows[1].pick).toEqual({ replace: 'b' });
	});

	it('shows one dimmed row when there are none', () => {
		expect(spellingRows([], false)).toEqual([{ label: 'No suggestions', pick: null }]);
	});

	it('ends with Add to dictionary only where the dictionary keeps words', () => {
		expect(spellingRows(['test'], true).at(-1)).toEqual({
			label: 'Add to dictionary',
			pick: { add: true }
		});
		expect(spellingRows([], true).at(-1)?.pick).toEqual({ add: true });
		expect(spellingRows(['test'], false).some((row) => row.label === 'Add to dictionary')).toBe(
			false
		);
	});
});
