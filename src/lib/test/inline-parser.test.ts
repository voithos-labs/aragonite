import { describe, it, expect } from 'vitest';
import { getContentRange, parseInline } from '../core/inline-parser';
import type { CstNode } from '../core/nodes';

describe('getContentRange', () => {
	it('paragraph: full raw minus trailing newline', () => {
		const node: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello **world**\n' };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 15 });
	});

	it('paragraph: handles CRLF', () => {
		const node: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\r\n' };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 5 });
	});

	it('heading level 1', () => {
		const node: CstNode = { kind: 'heading', leadingTrivia: '', raw: '# Hello\n', metadata: { level: 1 } };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 2, end: 7 });
	});

	it('heading level 3', () => {
		const node: CstNode = { kind: 'heading', leadingTrivia: '', raw: '### Hello\n', metadata: { level: 3 } };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 4, end: 9 });
	});

	it('heading with leading indent', () => {
		const node: CstNode = { kind: 'heading', leadingTrivia: '', raw: '  ## Hello\n', metadata: { level: 2 } };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 5, end: 10 });
	});

	it('setext heading single line', () => {
		const node: CstNode = { kind: 'setextHeading', leadingTrivia: '', raw: 'Hello World\n===\n', metadata: { level: 1 } };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 11 });
	});

	it('setext heading multi-line', () => {
		const node: CstNode = { kind: 'setextHeading', leadingTrivia: '', raw: 'Hello\nWorld\n===\n', metadata: { level: 1 } };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 11 });
	});

	it('paragraph without trailing newline', () => {
		const node: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello' };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 5 });
	});
});

describe('parseInline — backtick spans (Stage 1)', () => {
	function inlineOf(rawContent: string) {
		return parseInline(rawContent, 0, rawContent.length);
	}

	it('plain text with no markup', () => {
		const nodes = inlineOf('Hello world');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 11, text: 'Hello world' }
		]);
	});

	it('single backtick inline code', () => {
		const nodes = inlineOf('Hello `code` world');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 6, text: 'Hello ' },
			{ kind: 'inlineCode', start: 6, end: 12, text: 'code' },
			{ kind: 'text', start: 12, end: 18, text: ' world' }
		]);
	});

	it('double backtick inline code', () => {
		const nodes = inlineOf('Use ``code here`` ok');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 4, text: 'Use ' },
			{ kind: 'inlineCode', start: 4, end: 17, text: 'code here' },
			{ kind: 'text', start: 17, end: 20, text: ' ok' }
		]);
	});

	it('unmatched backtick is plain text', () => {
		const nodes = inlineOf('Hello `world');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 12, text: 'Hello `world' }
		]);
	});

	it('backtick length mismatch is plain text', () => {
		const nodes = inlineOf('Hello ``code` world');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 19, text: 'Hello ``code` world' }
		]);
	});

	it('empty inline code', () => {
		const nodes = inlineOf('Hello `` `` world');
		expect(nodes).toEqual([
			{ kind: 'text', start: 0, end: 6, text: 'Hello ' },
			{ kind: 'inlineCode', start: 6, end: 11, text: ' ' },
			{ kind: 'text', start: 11, end: 17, text: ' world' }
		]);
	});

	it('multiple inline code spans', () => {
		const nodes = inlineOf('`a` and `b`');
		expect(nodes.length).toBe(3);
		expect(nodes[0]).toEqual({ kind: 'inlineCode', start: 0, end: 3, text: 'a' });
		expect(nodes[1]).toEqual({ kind: 'text', start: 3, end: 8, text: ' and ' });
		expect(nodes[2]).toEqual({ kind: 'inlineCode', start: 8, end: 11, text: 'b' });
	});

	it('content-offset: heading raw with offset', () => {
		const raw = '## Hello `code` world\n';
		const range = getContentRange({ kind: 'heading', leadingTrivia: '', raw, metadata: { level: 2 } });
		const nodes = parseInline(raw, range.start, range.end);
		expect(nodes[0]).toEqual({ kind: 'text', start: 3, end: 9, text: 'Hello ' });
		expect(nodes[1]).toEqual({ kind: 'inlineCode', start: 9, end: 15, text: 'code' });
		expect(nodes[2]).toEqual({ kind: 'text', start: 15, end: 21, text: ' world' });
	});

	it('round-trip: concatenating inline nodes reproduces content', () => {
		const content = 'Hello `code` **not parsed yet** world';
		const nodes = inlineOf(content);
		const reconstructed = nodes.map(n => content.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(content);
	});
});
