// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	pickPasteStrategy,
	defaultInlineHook,
	defaultStructuralHook
} from '../../../tree-operations/paste/dispatch';
import { contentBlocks } from '../../../tree-operations/paste/strategy';
import { parse } from '../../../core/parser';
import type { CstNode } from '../../../core/nodes';

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

const blocksOf = (source: string) => parse(source).children;

describe('paste-dispatch — strategy selection', () => {
	it('picks inline for a single-paragraph clipboard', () => {
		expect(pickPasteStrategy(blocksOf('just some text\n'))).toBe('inline');
	});

	it('picks structural for multiple paragraphs', () => {
		expect(pickPasteStrategy(blocksOf('para one\n\npara two\n'))).toBe('structural');
	});

	it.each(['# just a heading\n', '- just an item\n', '```\ncode\n```\n'])(
		'picks structural for %j',
		(source) => {
			expect(pickPasteStrategy(blocksOf(source))).toBe('structural');
		}
	);
});

// A surface holding no blocks classifies past the copy's packaging; every other target reads the
// clipboard whole, which is what keeps a pasted blank run a blank run in prose.
describe('paste-dispatch — the clipboard’s content blocks', () => {
	const WRAPPED = '  \nhello\nworld\n  ';

	it('drops the blank blocks a copy wrapped around one paragraph', () => {
		expect(pickPasteStrategy(contentBlocks(blocksOf(WRAPPED)))).toBe('inline');
	});

	it('leaves that same clipboard structural for a target reading it whole', () => {
		expect(pickPasteStrategy(blocksOf(WRAPPED))).toBe('structural');
	});

	it('keeps two content blocks structural', () => {
		expect(pickPasteStrategy(contentBlocks(blocksOf('a\n\nb\n')))).toBe('structural');
	});

	it('keeps a single non-paragraph content block structural', () => {
		expect(pickPasteStrategy(contentBlocks(blocksOf('  \n# Hello\n  ')))).toBe('structural');
	});

	it('picks inline for packaging alone, so a whitespace paste splices no blocks', () => {
		expect(pickPasteStrategy(contentBlocks(blocksOf('\n\n\n')))).toBe('inline');
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
