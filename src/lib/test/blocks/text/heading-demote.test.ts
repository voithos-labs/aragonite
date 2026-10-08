import { describe, it, expect } from 'vitest';
import {
	cycleHeading,
	demoteEmptyAtxHeading,
	demoteToParagraph
} from '#lib/components/blocks/text/text-keydown.js';
import { getContentRange } from '#lib/core/inline/index.js';
import { parse } from '#lib/core/parser.js';

// Backspace at a live heading's content start drops every byte outside the kind's content range
// before it merges anything.

describe('demoteToParagraph', () => {
	it('drops an ATX prefix and lands the caret where the content now starts', () => {
		expect(demoteToParagraph('## Title\n', { start: 3, end: 8 }, 3)).toEqual({
			newRaw: 'Title\n',
			caretOffset: 0
		});
	});

	// The kind's content range skips up to three leading spaces, where a `#`-anchored rewrite
	// would write the block back unchanged and the key would do nothing at all.
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

	// A kind whose content is its whole displayed text has nothing structural to give up, so the
	// key belongs to the merge rather than to a rewrite that would change no bytes.
	it('declines when the content covers the whole display', () => {
		expect(demoteToParagraph('Title\n', { start: 0, end: 5 }, 0)).toBeNull();
	});
});

// Miss-analysis: no case had bytes past an ATX heading's content, so a closing run never demoted.
describe('demoteToParagraph: an ATX closing run', () => {
	function demoteHeading(raw: string, offset: number) {
		return demoteToParagraph(raw, getContentRange(parse(raw).children[0]), offset);
	}

	it('drops the closing run with the prefix and keeps the block’s own line ending', () => {
		expect(demoteHeading('## Title ##\r\n', 3)).toEqual({ newRaw: 'Title\r\n', caretOffset: 0 });
	});

	it('clamps a caret inside the closing run to the content end', () => {
		expect(demoteHeading('# Hi #\n', 6)).toEqual({ newRaw: 'Hi\n', caretOffset: 2 });
	});

	// Miss-analysis: no case ended the document's last line in a lone `\r`.
	it('keeps a lone `\r` ending the document’s last line, demoted or re-marked', () => {
		const raw = '# Hi #\r';
		const content = getContentRange(parse(raw).children[0]);
		expect(demoteToParagraph(raw, content, 2)?.newRaw).toBe('Hi\r');
		expect(cycleHeading(raw, content, 2, 2)?.newRaw).toBe('## Hi\r');
	});
});

describe('demoteToParagraph: a setext underline', () => {
	it('keeps the block’s own trailing line ending', () => {
		expect(demoteToParagraph('Title\r\n===\r\n', { start: 0, end: 5 }, 0)).toEqual({
			newRaw: 'Title\r\n',
			caretOffset: 0
		});
	});

	// The suffix is entirely past the caret, so an offset inside the content survives untouched;
	// one somehow past it clamps rather than pointing into bytes that no longer exist.
	it('clamps a caret past the content end', () => {
		expect(demoteToParagraph('Title\n===\n', { start: 0, end: 5 }, 8)).toEqual({
			newRaw: 'Title\n',
			caretOffset: 5
		});
	});
});

// On blur, only an ATX heading with no text becomes the empty paragraph it looks like; a setext
// heading has no prefix standing over nothing.
describe('demoteEmptyAtxHeading', () => {
	it('drops the marker of a heading left with no text', () => {
		expect(demoteEmptyAtxHeading('## \n', { start: 3, end: 3 })).toEqual({
			newRaw: '\n',
			caretOffset: 0
		});
	});

	// Dropping only the prefix of an empty heading with a closing run leaves `#`, a heading again.
	it('drops the closing run of an empty heading too', () => {
		const raw = '# #\n';
		expect(demoteEmptyAtxHeading(raw, getContentRange(parse(raw).children[0]))).toEqual({
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
