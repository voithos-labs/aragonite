import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { toMutable, serializeMutable } from '../mutable-tree';
import { splitNode } from '../tree-operations';

describe('splitNode', () => {
    it('splits a paragraph into two paragraphs', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 5);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Hello\n');
        expect(mutable.children[1].raw).toBe(' World\n');
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[1].kind).toBe('paragraph');
    });

    it('preserves the original ID and assigns a new one', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['original-id'];
        splitNode(mutable, ids, 0, 5);
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe('original-id');
        expect(ids[1]).not.toBe('original-id');
    });

    it('splits at the beginning creates empty first paragraph', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 0);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[0].raw).toBe('\n');
        expect(mutable.children[1].raw).toBe('Hello\n');
    });

    it('splits at the end creates empty second paragraph', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 5);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Hello\n');
        expect(mutable.children[1].kind).toBe('paragraph');
        expect(mutable.children[1].raw).toBe('\n');
    });

    it('second block has empty leading trivia (no blank line)', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 5);
        expect(mutable.children[1].leadingTrivia).toBe('');
    });

    it('preserves leading trivia on the first block when splitting a non-first block', () => {
        const source = 'First\n\nSecond\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2'];
        splitNode(mutable, ids, 1, 3);
        expect(mutable.children[1].leadingTrivia).toBe('\n');
        expect(mutable.children[2].leadingTrivia).toBe('');
    });

    it('handles multi-line paragraph split', () => {
        const source = 'Line one.\nLine two.\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 10);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Line one.\n');
        expect(mutable.children[1].raw).toBe('Line two.\n');
    });

    it('produces correct serialization after split', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 5);
        const result = serializeMutable(mutable);
        expect(result).toBe('Hello\n World\n');
    });

    it('handles CRLF line endings correctly', () => {
        const source = 'Hello World\r\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 5);
        expect(mutable.children[0].raw).toBe('Hello\r\n');
        expect(mutable.children[1].raw).toBe(' World\r\n');
    });
});
