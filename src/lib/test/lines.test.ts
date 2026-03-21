import { describe, it, expect } from 'vitest';
import { splitLines } from '../core/lines';

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
