import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serializeMutable } from '../mutable-tree';
import { unwrapFirstChildFromBlockquote } from '../tree-operations';
import type { CstNode } from '../core/nodes';

// ── unwrapFirstChildFromBlockquote ─────────────────────────────────────────

describe('unwrapFirstChildFromBlockquote', () => {
    function parseBlockquote(src: string): CstNode {
        const doc = parse(src);
        const bq = doc.children[0];
        if (bq?.kind !== 'blockquote') {
            throw new Error(`expected blockquote, got ${bq?.kind}`);
        }
        return bq;
    }

    it('single-paragraph blockquote returns just the lifted paragraph', () => {
        const bq = parseBlockquote('> Hello world\n');
        const snapshot = JSON.stringify(bq);

        const result = unwrapFirstChildFromBlockquote(bq);

        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('paragraph');
        expect((result[0].raw ?? '').trim()).toBe('Hello world');
        // Input not mutated
        expect(JSON.stringify(bq)).toBe(snapshot);
    });

    it('multi-paragraph blockquote returns lifted paragraph + shrunk blockquote', () => {
        const bq = parseBlockquote('> First\n>\n> Second\n');

        const result = unwrapFirstChildFromBlockquote(bq);

        expect(result).toHaveLength(2);
        expect(result[0].kind).toBe('paragraph');
        expect((result[0].raw ?? '').trim()).toBe('First');
        expect(result[1].kind).toBe('blockquote');
        // The remaining blockquote still serializes with its prefix.
        const remainingRaw = result[1].raw ?? '';
        expect(remainingRaw).toMatch(/^> /m);
        expect(remainingRaw).toContain('Second');
        expect(remainingRaw).not.toContain('First');
    });

    it('blockquote whose first child is itself a blockquote lifts the inner blockquote', () => {
        const bq = parseBlockquote('> > Deep\n');

        const result = unwrapFirstChildFromBlockquote(bq);

        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('blockquote');
        const innerRaw = result[0].raw ?? '';
        expect(innerRaw).toContain('Deep');
    });

    it('blockquote whose first child is a list lifts the list', () => {
        const bq = parseBlockquote('> - Item\n');

        const result = unwrapFirstChildFromBlockquote(bq);

        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('list');
    });

    it('input blockquote is not mutated', () => {
        const bq = parseBlockquote('> First\n>\n> Second\n');
        const before = serializeMutable({
            children: [bq],
            prefix: '',
            suffix: ''
        });

        unwrapFirstChildFromBlockquote(bq);

        const after = serializeMutable({
            children: [bq],
            prefix: '',
            suffix: ''
        });
        expect(after).toBe(before);
    });
});
