import { describe, expect, it } from 'vitest';
import { createTypingWord } from '#packages/spellcheck/src/typing-word.js';

describe('createTypingWord', () => {
	it('holds the word being typed, and no other', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		expect(typing.holds(8)).toBe(true);
		expect(typing.holds(0)).toBe(false);
	});

	it('keeps it while the caret stays in the word, ends included', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		expect(typing.moved(8)).toBe(false);
		expect(typing.moved(12)).toBe(false);
		expect(typing.holds(8)).toBe(true);
	});

	it('lets it go once the caret leaves, and says so once', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		expect(typing.moved(13)).toBe(true);
		expect(typing.holds(8)).toBe(false);
		expect(typing.moved(13)).toBe(false);
	});

	it('lets it go when the selection becomes a range or goes away', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		expect(typing.moved(null)).toBe(true);
	});

	it('lets it go on any other edit or another document', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		expect(typing.release()).toBe(true);
		expect(typing.holds(8)).toBe(false);
		expect(typing.release()).toBe(false);
	});

	it('holds nothing when the typing left the caret outside any word', () => {
		const typing = createTypingWord();
		typing.typed({ from: 8, to: 12 });
		typing.typed(null);
		expect(typing.holds(8)).toBe(false);
	});
});
