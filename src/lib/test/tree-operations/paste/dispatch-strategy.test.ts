// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	pickPasteStrategy,
	defaultInlineHook,
	defaultStructuralHook
} from '../../../tree-operations/paste/dispatch';
import { parse } from '../../../core/parser';
import type { CstNode } from '../../../core/nodes';

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('paste-dispatch — strategy selection', () => {
	it('picks inline for a single-paragraph clipboard', () => {
		const parsed = parse('just some text\n');
		expect(pickPasteStrategy(parsed)).toBe('inline');
	});

	it('picks structural for multiple paragraphs', () => {
		const parsed = parse('para one\n\npara two\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single heading', () => {
		const parsed = parse('# just a heading\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single list', () => {
		const parsed = parse('- just an item\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single code block', () => {
		const parsed = parse('```\ncode\n```\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});
});

describe('paste-dispatch — default inline hook', () => {
	it('splices text at offset into raw', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 5, ' XYZ');
		expect(result.newRaw).toBe('hello XYZ world\n');
		expect(result.caretOffset).toBe(9);
	});

	it('with preDelete: removes range then splices', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 0, 'XYZ', { start: 0, end: 5 });
		expect(result.newRaw).toBe('XYZ world\n');
		expect(result.caretOffset).toBe(3);
	});

	it('preserves CRLF line ending', () => {
		const node = makePara('hello\r\n');
		const result = defaultInlineHook(node, 5, '!');
		expect(result.newRaw).toBe('hello!\r\n');
	});

	it('with empty preDelete range is equivalent to no preDelete', () => {
		const node = makePara('hello\n');
		const a = defaultInlineHook(node, 3, 'X', { start: 3, end: 3 });
		const b = defaultInlineHook(node, 3, 'X');
		expect(a).toEqual(b);
	});
});

describe('paste-dispatch — default structural hook', () => {
	it('delegates to buildPastedReplacement for a single heading', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThan(0);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 1);
	});

	it('produces a replacement sequence for multi-block input', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n\npara\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThanOrEqual(2);
	});
});
