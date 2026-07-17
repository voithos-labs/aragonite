import { describe, it, expect } from 'vitest';
import { splitLines, trailingLineEnding } from '../../core/lines';

describe('trailingLineEnding', () => {
	it('reports CRLF when the raw ends with one', () => {
		expect(trailingLineEnding('a\r\n')).toBe('\r\n');
	});

	it('reports LF when the raw ends with a bare newline', () => {
		expect(trailingLineEnding('a\n')).toBe('\n');
	});

	// A block with no trailing ending (a document-final block) keeps the LF the
	// commit path has always appended — matching the code-paste-surface sibling.
	it('defaults to LF when the raw has no trailing ending', () => {
		expect(trailingLineEnding('a')).toBe('\n');
	});

	it('reads only the trailing ending, not an interior CRLF', () => {
		expect(trailingLineEnding('a\r\nb\n')).toBe('\n');
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
