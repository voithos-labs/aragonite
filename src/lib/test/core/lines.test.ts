import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

	// Read afresh, so a write that gives the document its first break counts at once.
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

	it('splits as a walk over every character does, lone CRs included', () => {
		const unit = fc.constantFrom('a', ' ', '\t', '\n', '\r', '\r\n', '汉');
		fc.assert(
			fc.property(fc.array(unit, { maxLength: 30 }), (units) => {
				const source = units.join('');
				expect(splitLines(source)).toEqual(splitEachCharacter(source));
			})
		);
	});
});

function splitEachCharacter(source: string): ReturnType<typeof splitLines> {
	const lines: ReturnType<typeof splitLines> = [];
	let start = 0;
	for (let i = 0; i < source.length; i++) {
		if (source[i] !== '\n') continue;
		const lineEnding = source[i - 1] === '\r' ? '\r\n' : '\n';
		const raw = source.slice(start, i + 1);
		lines.push({ raw, text: raw.slice(0, -lineEnding.length), lineEnding, start, end: i + 1 });
		start = i + 1;
	}
	if (start < source.length) {
		const raw = source.slice(start);
		lines.push({ raw, text: raw, lineEnding: '', start, end: source.length });
	}
	return lines;
}
