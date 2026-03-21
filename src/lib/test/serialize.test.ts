import { describe, it, expect } from 'vitest';
import { serialize } from '../core/serializer';
import { Document, Heading, Paragraph, ThematicBreak } from '../core/nodes';

describe('serialize', () => {
    it('serializes an empty document', () => {
        const doc = new Document('', [], '');
        expect(serialize(doc)).toBe('');
    });

    it('serializes a document with prefix and suffix', () => {
        const doc = new Document('\n\n', [new Heading('', '# Title\n', { level: 1 })], '\n');
        expect(serialize(doc)).toBe('\n\n# Title\n\n');
    });

    it('serializes multiple blocks with leading trivia', () => {
        const doc = new Document(
            '',
            [
                new Heading('', '# Title\n', { level: 1 }),
                new Paragraph('\n', 'Some text.\n'),
                new ThematicBreak('\n', '---\n', { marker: '-' })
            ],
            ''
        );
        expect(serialize(doc)).toBe('# Title\n\nSome text.\n\n---\n');
    });
});
