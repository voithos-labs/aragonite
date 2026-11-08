// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localStorageWords } from '#packages/spellcheck/src/local-words.js';

const KEY = 'test:spelling';

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('localStorageWords', () => {
	it('writes nothing until a word is added', () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		localStorageWords(KEY);
		expect(setItem).not.toHaveBeenCalled();
	});

	it('hands back the saved words, and keeps an added one beside what another tab saved', () => {
		localStorage.setItem(KEY, JSON.stringify(['aragonite']));
		const kept = localStorageWords(KEY);
		expect(kept.words).toEqual(['aragonite']);
		localStorage.setItem(KEY, JSON.stringify(['aragonite', 'limestone']));
		kept.onAddWord('voithos');
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['aragonite', 'limestone', 'voithos']);
		kept.onAddWord('voithos');
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['aragonite', 'limestone', 'voithos']);
	});

	it('reads anything but a list of words as no words', () => {
		localStorage.setItem(KEY, '{not json');
		expect(localStorageWords(KEY).words).toEqual([]);
		localStorage.setItem(KEY, JSON.stringify({ words: ['x'] }));
		expect(localStorageWords(KEY).words).toEqual([]);
		localStorage.setItem(KEY, JSON.stringify(['ok', 3, null]));
		expect(localStorageWords(KEY).words).toEqual(['ok']);
	});

	it('never throws when the storage refuses, reading or writing', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		const kept = localStorageWords(KEY);
		expect(kept.words).toEqual([]);
		expect(() => kept.onAddWord('catt')).not.toThrow();
	});
});
