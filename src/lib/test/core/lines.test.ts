import { describe, it, expect } from 'vitest';
import {
	displayLines,
	documentLineEnding,
	firstDisplayLine,
	firstLineEnding,
	joinDisplayLines,
	splitLines,
	trailingLineEnding
} from '../../core/lines';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

describe('trailingLineEnding', () => {
	it('reads the ending the raw closes with, whatever the fallback', () => {
		expect(trailingLineEnding('a\r\n', '\n')).toBe('\r\n');
		expect(trailingLineEnding('a\n', '\r\n')).toBe('\n');
	});

	it('gives a raw with no ending of its own the fallback', () => {
		expect(trailingLineEnding('a', '\r\n')).toBe('\r\n');
	});

	it('reads only the trailing ending, not an interior CRLF', () => {
		expect(trailingLineEnding('a\r\nb\n', '\r\n')).toBe('\n');
	});
});

describe('documentLineEnding', () => {
	it('is the first break in the source', () => {
		expect(documentLineEnding(parse('abc\r\n\r\nlast'))).toBe('\r\n');
		expect(documentLineEnding(parse('# h\n\ntext\r\n'))).toBe('\n');
	});

	it("finds a CRLF split across two blocks' bytes", () => {
		const doc = parse('a\r\n\r\nb');
		doc.children[0].raw = 'a\r';
		doc.children[1].leadingTrivia = '\n';
		expect(documentLineEnding(doc)).toBe('\r\n');
	});

	it('is LF for a document holding no break', () => {
		expect(documentLineEnding(parse('one line'))).toBe('\n');
		expect(documentLineEnding(parse(''))).toBe('\n');
	});

	// The memo holds only a found break, so a write that gives the document its first one counts.
	it('sees the first break a write introduces', () => {
		const doc = parse('one line');
		expect(documentLineEnding(doc)).toBe('\n');
		doc.children = parse('one line\r\nand another').children;
		expect(serialize(doc)).toBe('one line\r\nand another');
		expect(documentLineEnding(doc)).toBe('\r\n');
	});
});

describe('firstLineEnding', () => {
	it('reads the first break, or null when there is none', () => {
		expect(firstLineEnding('a\r\nb\n')).toBe('\r\n');
		expect(firstLineEnding('a\nb\r\n')).toBe('\n');
		expect(firstLineEnding('a')).toBeNull();
	});
});

describe('displayLines', () => {
	it('gives each line its text apart from its ending', () => {
		expect(displayLines('a\r\nb\nc')).toEqual([
			{ text: 'a', ending: '\r\n' },
			{ text: 'b', ending: '\n' },
			{ text: 'c', ending: '' }
		]);
	});

	it('keeps the empty last line after a final break, and the one line of an empty display', () => {
		expect(displayLines('a\r\n')).toEqual([
			{ text: 'a', ending: '\r\n' },
			{ text: '', ending: '' }
		]);
		expect(displayLines('')).toEqual([{ text: '', ending: '' }]);
	});

	it.each(['', 'a', 'a\r\n\r\nb', '\n\n', 'a\r\nb\n'])('joins %j back to its bytes', (display) => {
		expect(joinDisplayLines(displayLines(display))).toBe(display);
		expect(firstDisplayLine(display)).toEqual(displayLines(display)[0]);
	});
});

describe('splitLines', () => {
	it('splits LF lines and preserves endings', () => {
		const lines = splitLines('a\nb\nc\n');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b\n', text: 'b', lineEnding: '\n', start: 2, end: 4 },
			{ raw: 'c\n', text: 'c', lineEnding: '\n', start: 4, end: 6 }
		]);
	});

	it('splits CRLF lines and preserves endings', () => {
		const lines = splitLines('a\r\nb\r\n');
		expect(lines).toEqual([
			{ raw: 'a\r\n', text: 'a', lineEnding: '\r\n', start: 0, end: 3 },
			{ raw: 'b\r\n', text: 'b', lineEnding: '\r\n', start: 3, end: 6 }
		]);
	});

	it('handles final line without trailing newline', () => {
		const lines = splitLines('a\nb');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b', text: 'b', lineEnding: '', start: 2, end: 3 }
		]);
	});

	it('handles empty string', () => {
		const lines = splitLines('');
		expect(lines).toEqual([]);
	});

	it('handles single line no newline', () => {
		const lines = splitLines('hello');
		expect(lines).toEqual([{ raw: 'hello', text: 'hello', lineEnding: '', start: 0, end: 5 }]);
	});
});
