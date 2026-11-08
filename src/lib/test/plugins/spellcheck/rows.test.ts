import { describe, expect, it } from 'vitest';
import { spellingPick, spellingRows } from '#packages/spellcheck/src/rows.js';

describe('spellingRows', () => {
	it('shows one dimmed row while the suggestions are on their way, and one when there are none', () => {
		expect(spellingRows(null, false)).toEqual([
			{ id: 'spell.pending', label: 'Finding suggestions…', disabled: true }
		]);
		expect(spellingRows([], false)).toEqual([
			{ id: 'spell.none', label: 'No suggestions', disabled: true }
		]);
	});

	it('lists five suggestions at most, best first', () => {
		const rows = spellingRows(['a', 'b', 'c', 'd', 'e', 'f', 'g'], false);
		expect(rows.map((row) => row.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(rows.map((row) => row.id)).toEqual([
			'spell.0',
			'spell.1',
			'spell.2',
			'spell.3',
			'spell.4'
		]);
	});

	it('ends with Add to dictionary only where the dictionary keeps words', () => {
		expect(spellingRows(['test'], true).at(-1)).toEqual({
			id: 'spell.add',
			label: 'Add to dictionary'
		});
		expect(spellingRows(null, true).at(-1)?.id).toBe('spell.add');
		expect(spellingRows(['test'], false).some((row) => row.id === 'spell.add')).toBe(false);
	});
});

describe('spellingPick', () => {
	const suggestions = ['test', 'tsetse'];

	it('reads a suggestion row back as its word, and the add row as an add', () => {
		expect(spellingPick('spell.1', suggestions)).toEqual({ replace: 'tsetse' });
		expect(spellingPick('spell.add', suggestions)).toEqual({ add: true });
	});

	it('reads a dimmed row, a row past the list, or another menu’s row as nothing', () => {
		expect(spellingPick('spell.pending', null)).toBeNull();
		expect(spellingPick('spell.none', [])).toBeNull();
		expect(spellingPick('spell.4', suggestions)).toBeNull();
		expect(spellingPick('clip.copy', suggestions)).toBeNull();
	});
});
