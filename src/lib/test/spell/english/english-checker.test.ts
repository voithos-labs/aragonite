import { describe, expect, it } from 'vitest';
import { createEnglishSpellChecker } from '#lib/spell/english/english-checker.js';

// The real dictionary: the first check loads it, and every check after answers at once.
describe('createEnglishSpellChecker', () => {
	const checker = createEnglishSpellChecker({ words: ['aragonite'] });

	it('loads the dictionary on the first check and answers synchronously after', async () => {
		expect(await checker.check('hello')).toBe(true);
		expect(checker.check('hello')).toBe(true);
		expect(checker.check('helo')).toBe(false);
	});

	it('accepts a capitalised word at a sentence start and a word in capitals', () => {
		expect(checker.check('Hello')).toBe(true);
		expect(checker.check('HELLO')).toBe(true);
		expect(checker.check('Paris')).toBe(true);
		expect(checker.check('paris')).toBe(false);
		expect(checker.check('PARIS')).toBe(true);
	});

	it('reads affixed forms and apostrophes either way round', () => {
		expect(checker.check('walked')).toBe(true);
		expect(checker.check('unhappiness')).toBe(true);
		expect(checker.check("don't")).toBe(true);
		expect(checker.check('don’t')).toBe(true);
		expect(checker.check("John's")).toBe(true);
	});

	it('accepts the words a host handed it, and the ones added since', () => {
		expect(checker.check('aragonite')).toBe(true);
		expect(checker.check('limestoney')).toBe(false);
		void checker.addWord!('limestoney');
		expect(checker.check('limestoney')).toBe(true);
	});

	it('suggests the obvious fix first', () => {
		expect(checker.suggest('helo')).toContain('hello');
		expect((checker.suggest('teh') as string[])[0]).toBe('the');
		expect((checker.suggest('recieve') as string[])[0]).toBe('receive');
		expect((checker.suggest('Teh') as string[])[0]).toBe('The');
		expect(checker.suggest('alot')).toContain('a lot');
		expect((checker.suggest('paris') as string[])[0]).toBe('Paris');
	});

	it('offers at most five, none of them taboo, and nothing for noise', () => {
		expect((checker.suggest('wrod') as string[]).length).toBeLessThanOrEqual(5);
		expect(checker.suggest('xqzjv')).toEqual([]);
	});

	it('reports what a call to addWord added', () => {
		const added: string[] = [];
		const own = createEnglishSpellChecker({ onAddWord: (w) => added.push(w) });
		void own.addWord!('Voithos');
		expect(added).toEqual(['Voithos']);
	});
});
