import { describe, expect, it, vi } from 'vitest';
import { englishDictionary } from '#packages/spellcheck/src/english/english-dictionary.js';

// The real word list: the first check loads it, and every answer after comes at once.
describe('englishDictionary: checking', () => {
	const dictionary = englishDictionary({ words: ['aragonite'] });

	it('loads the list on the first check and answers synchronously after', async () => {
		expect(await dictionary.check('hello')).toBe(true);
		expect(dictionary.check('hello')).toBe(true);
		expect(dictionary.check('helo')).toBe(false);
	});

	it('accepts a capitalised word at a sentence start and a word in capitals', () => {
		expect(dictionary.check('Hello')).toBe(true);
		expect(dictionary.check('HELLO')).toBe(true);
		expect(dictionary.check('Paris')).toBe(true);
		expect(dictionary.check('paris')).toBe(false);
		expect(dictionary.check('PARIS')).toBe(true);
	});

	it('reads affixed forms and apostrophes either way round', () => {
		expect(dictionary.check('walked')).toBe(true);
		expect(dictionary.check('unhappiness')).toBe(true);
		expect(dictionary.check("don't")).toBe(true);
		expect(dictionary.check('don’t')).toBe(true);
		expect(dictionary.check("John's")).toBe(true);
	});

	it('reads an accent the way the list spells the word, composed or combining', () => {
		expect(dictionary.check('café')).toBe(true);
		expect(dictionary.check('café')).toBe(true);
		expect(dictionary.check('cafés')).toBe(true);
	});

	it('leaves a word with no Latin letter alone, and suggests nothing for it', () => {
		expect(dictionary.check('日本語のテキストです')).toBe(true);
		expect(dictionary.check('Привет')).toBe(true);
		expect(dictionary.suggest('Привет')).toEqual([]);
	});

	it('accepts the words the host saved', () => {
		expect(dictionary.check('aragonite')).toBe(true);
		expect(dictionary.check('Aragonite')).toBe(true);
	});
});

describe('englishDictionary: suggesting', () => {
	const dictionary = englishDictionary();

	it('suggests the obvious fix first, in the word’s casing', async () => {
		await dictionary.check('hello');
		expect(dictionary.suggest('helo')).toContain('hello');
		expect((dictionary.suggest('teh') as string[])[0]).toBe('the');
		expect((dictionary.suggest('recieve') as string[])[0]).toBe('receive');
		expect((dictionary.suggest('Teh') as string[])[0]).toBe('The');
		expect(dictionary.suggest('alot')).toContain('a lot');
		expect((dictionary.suggest('paris') as string[])[0]).toBe('Paris');
	});

	it('offers at most five, and nothing for noise', async () => {
		await dictionary.check('hello');
		expect((dictionary.suggest('wrod') as string[]).length).toBeLessThanOrEqual(5);
		expect(dictionary.suggest('xqzjv')).toEqual([]);
	});
});

describe('englishDictionary: added words', () => {
	it('offers no add when nothing keeps the word', () => {
		expect(englishDictionary().add).toBeUndefined();
		expect(englishDictionary({ words: ['saved'] }).add).toBeUndefined();
	});

	it('accepts an added word in every casing, and hands the host the word as written', async () => {
		const onAddWord = vi.fn();
		const dictionary = englishDictionary({ onAddWord });
		expect(await dictionary.check('Limestoney')).toBe(false);
		await dictionary.add!('Limestoney');
		expect(onAddWord).toHaveBeenCalledWith('Limestoney');
		expect(dictionary.check('limestoney')).toBe(true);
		expect(dictionary.check('LIMESTONEY')).toBe(true);
	});

	it('tells the editors watching this dictionary, and only this one, when a word is added', async () => {
		const shared = englishDictionary({ onAddWord: () => {} });
		const other = englishDictionary({ onAddWord: () => {} });
		const first = vi.fn();
		const second = vi.fn();
		const elsewhere = vi.fn();
		const stop = shared.watch!(first);
		shared.watch!(second);
		other.watch!(elsewhere);
		await shared.add!('catt');
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		expect(elsewhere).not.toHaveBeenCalled();
		stop();
		await shared.add!('dogg');
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(2);
	});

	it('keeps a word for the session when the host fails to save it', async () => {
		const dictionary = englishDictionary({
			onAddWord: () => Promise.reject(new Error('disk full'))
		});
		await expect(dictionary.add!('catt')).rejects.toThrow('disk full');
		expect(await dictionary.check('catt')).toBe(true);
	});
});
