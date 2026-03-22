// src/lib/editor/test/merge-rules.test.ts
import { describe, it, expect } from 'vitest';
import { isMergeEligible, isBlockEditable } from '../merge-rules';

describe('isMergeEligible', () => {
    it('two paragraphs are mergeable', () => {
        expect(isMergeEligible('paragraph', 'paragraph')).toBe(true);
    });

    it('heading + paragraph are mergeable (heading absorbs)', () => {
        expect(isMergeEligible('heading', 'paragraph')).toBe(true);
    });

    it('setextHeading + paragraph are mergeable', () => {
        expect(isMergeEligible('setextHeading', 'paragraph')).toBe(true);
    });

    it('two headings are NOT mergeable', () => {
        expect(isMergeEligible('heading', 'heading')).toBe(false);
    });

    it('paragraph + heading are NOT mergeable', () => {
        expect(isMergeEligible('paragraph', 'heading')).toBe(false);
    });

    it('fencedCode + anything are NOT mergeable', () => {
        expect(isMergeEligible('fencedCode', 'paragraph')).toBe(false);
        expect(isMergeEligible('paragraph', 'fencedCode')).toBe(false);
    });

    it('thematicBreak + anything are NOT mergeable', () => {
        expect(isMergeEligible('thematicBreak', 'paragraph')).toBe(false);
    });

    it('two unrecognized blocks are mergeable', () => {
        expect(isMergeEligible('unrecognized', 'unrecognized')).toBe(true);
    });

    it('table + paragraph are NOT mergeable', () => {
        expect(isMergeEligible('table', 'paragraph')).toBe(false);
    });

    it('container blocks are NOT mergeable', () => {
        expect(isMergeEligible('blockquote', 'paragraph')).toBe(false);
        expect(isMergeEligible('list', 'paragraph')).toBe(false);
    });
});

describe('isBlockEditable', () => {
    it('paragraph is editable', () => {
        expect(isBlockEditable('paragraph')).toBe(true);
    });

    it('heading is editable', () => {
        expect(isBlockEditable('heading')).toBe(true);
    });

    it('fencedCode is editable', () => {
        expect(isBlockEditable('fencedCode')).toBe(true);
    });

    it('thematicBreak is NOT editable', () => {
        expect(isBlockEditable('thematicBreak')).toBe(false);
    });

    it('container blocks are editable (hold text content via children)', () => {
        expect(isBlockEditable('blockquote')).toBe(true);
        expect(isBlockEditable('list')).toBe(true);
        expect(isBlockEditable('listItem')).toBe(true);
    });
});
