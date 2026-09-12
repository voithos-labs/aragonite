import { describe, it, expect } from 'vitest';
import {
	demoteEmptyAtxHeading,
	demoteToParagraph,
	dropStructuralSuffix
} from '$lib/components/blocks/text/text-keydown';

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

	// The gate is the kind's content range, which skips up to three leading spaces; a prefix
	// rewrite that reads the `#`s with its own regex writes the block back unchanged there, and
	// the press disappears — no demote, and the merge cascade never sees it either.
	it('drops an indented ATX prefix, which no `#`-anchored regex reaches', () => {
		expect(demoteToParagraph('  ## Indented\n', { start: 5, end: 13 }, 5)).toEqual({
			newRaw: 'Indented\n',
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

// The blur rule: an ATX heading with no text becomes the empty paragraph it looks like, and
// nothing else does — a heading with text keeps its marker, and a setext heading has no prefix
// standing over nothing.
describe('demoteEmptyAtxHeading', () => {
	it('drops the marker of a heading left with no text', () => {
		expect(demoteEmptyAtxHeading('## \n', { start: 3, end: 3 })).toEqual({
			newRaw: '\n',
			caretOffset: 0
		});
	});

	it('leaves a heading with text alone', () => {
		expect(demoteEmptyAtxHeading('## Title\n', { start: 3, end: 8 })).toBeNull();
	});

	it('leaves a setext heading alone, whose content starts at zero', () => {
		expect(demoteEmptyAtxHeading('\n===\n', { start: 0, end: 0 })).toBeNull();
	});
});
