import { describe, it, expect } from 'vitest';
import { demoteToParagraph, dropStructuralSuffix } from '$lib/components/blocks/text/text-keydown';

// Backspace at a live heading's content start drops the block's own structural bytes before it
// merges anything. Which bytes those are is the kind's content range talking: a prefix for ATX, a
// suffix for setext — the same declaration, read from both ends.

describe('demoteToParagraph', () => {
	it('drops an ATX prefix and lands the caret where the content now starts', () => {
		expect(demoteToParagraph('## Title\n', { start: 3, end: 8 }, 3)).toEqual({
			newRaw: 'Title\n',
			caretOffset: 0
		});
	});

	it('drops a setext underline and leaves the caret alone', () => {
		expect(demoteToParagraph('Title\n===\n', { start: 0, end: 5 }, 0)).toEqual({
			newRaw: 'Title\n',
			caretOffset: 0
		});
	});

	// A kind whose content IS its whole display has nothing structural to give up, so the press
	// belongs to the merge cascade rather than to a rewrite that would change no bytes.
	it('declines when the content covers the whole display', () => {
		expect(demoteToParagraph('Title\n', { start: 0, end: 5 }, 0)).toBeNull();
	});
});

describe('dropStructuralSuffix', () => {
	it('keeps the block’s own trailing line ending', () => {
		expect(dropStructuralSuffix('Title\r\n===\r\n', 5, 0)).toEqual({
			newRaw: 'Title\r\n',
			caretOffset: 0
		});
	});

	// The suffix is entirely past the caret, so an offset inside the content survives untouched;
	// one somehow past it clamps rather than pointing into bytes that no longer exist.
	it('clamps a caret past the content end', () => {
		expect(dropStructuralSuffix('Title\n===\n', 5, 8)).toEqual({
			newRaw: 'Title\n',
			caretOffset: 5
		});
	});
});
