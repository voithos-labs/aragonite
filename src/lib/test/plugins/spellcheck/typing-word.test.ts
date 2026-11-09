import { describe, expect, it } from 'vitest';
import { createTypingWord } from '#packages/spellcheck/src/typing-word.js';

const BLOCK = { from: 0, to: 20 };
const WORD = { from: 8, to: 12 };
const SPANS = [{ from: 2, to: 6 }, WORD];

/** A keystroke at byte 10, and its block painted. */
function typedInWord() {
	const typing = createTypingWord();
	typing.typed(10);
	typing.painted(BLOCK, SPANS);
	return typing;
}

describe('createTypingWord', () => {
	it('holds the word at the keystroke once its block paints, and no other', () => {
		const typing = createTypingWord();
		typing.typed(10);
		expect(typing.holds(8)).toBe(false);
		typing.painted(BLOCK, SPANS);
		expect([typing.holds(8), typing.holds(2)]).toEqual([true, false]);
	});

	it('waits for the block holding the keystroke, past one that paints first', () => {
		const typing = createTypingWord();
		typing.typed(10);
		typing.painted({ from: 30, to: 40 }, [{ from: 30, to: 34 }]);
		typing.painted(BLOCK, SPANS);
		expect(typing.holds(8)).toBe(true);
	});

	it('keeps the word through the keystroke’s own caret move, reported before the paint', () => {
		const typing = createTypingWord();
		typing.typed(10);
		expect(typing.moved(10)).toBeNull();
		typing.painted(BLOCK, SPANS);
		expect(typing.holds(8)).toBe(true);
	});

	it('keeps it while the caret stays in the word, ends included', () => {
		const typing = typedInWord();
		expect([typing.moved(8), typing.moved(12)]).toEqual([null, null]);
		expect(typing.holds(8)).toBe(true);
	});

	it('lets it go once the caret leaves, and hands it back once', () => {
		const typing = typedInWord();
		expect(typing.moved(13)).toEqual(WORD);
		expect(typing.holds(8)).toBe(false);
		expect(typing.moved(13)).toBeNull();
	});

	it('lets it go when the selection becomes a range or goes away', () => {
		expect(typedInWord().moved(null)).toEqual(WORD);
	});

	it('lets it go on any other edit or another document', () => {
		const typing = typedInWord();
		expect(typing.release()).toEqual(WORD);
		expect(typing.holds(8)).toBe(false);
		expect(typing.release()).toBeNull();
	});

	it('holds nothing when the keystroke left the caret outside any word', () => {
		const typing = typedInWord();
		typing.typed(7);
		typing.painted(BLOCK, SPANS);
		expect(typing.holds(8)).toBe(false);
	});
});
