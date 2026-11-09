import { describe, expect, it } from 'vitest';
import { createTypingWord } from '#packages/spellcheck/src/typing-word.js';

const WORD = { from: 8, to: 12 };

describe('createTypingWord', () => {
	it('holds the word being typed, and no other', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		expect(typing.holds(8)).toBe(true);
		expect(typing.holds(0)).toBe(false);
	});

	it('keeps it while the caret stays in the word, ends included', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		expect(typing.moved(8)).toBeNull();
		expect(typing.moved(12)).toBeNull();
		expect(typing.holds(8)).toBe(true);
	});

	it('lets it go once the caret leaves, and hands it back once', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		expect(typing.moved(13)).toEqual(WORD);
		expect(typing.holds(8)).toBe(false);
		expect(typing.moved(13)).toBeNull();
	});

	it('lets it go when the selection becomes a range or goes away', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		expect(typing.moved(null)).toEqual(WORD);
	});

	it('lets it go on any other edit or another document', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		expect(typing.release()).toEqual(WORD);
		expect(typing.holds(8)).toBe(false);
		expect(typing.release()).toBeNull();
	});

	it('holds nothing when the typing left the caret outside any word', () => {
		const typing = createTypingWord();
		typing.typed(WORD);
		typing.typed(null);
		expect(typing.holds(8)).toBe(false);
	});
});
