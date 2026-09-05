import { describe, it, expect } from 'vitest';
import { getContentRange, parseInline } from '../../core/inline';
import type { CstNode } from '../../core/nodes';

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
		const node: CstNode = {
			kind: 'heading',
			leadingTrivia: '',
			raw: '# Hello\n',
			metadata: { level: 1 }
		};
		const range = getContentRange(node);
		expect(range).toEqual({ start: 2, end: 7 });
	});

	it('heading level 3', () => {
		const node: CstNode = {
			kind: 'heading',
			leadingTrivia: '',
			raw: '### Hello\n',
			metadata: { level: 3 }
		};
		const range = getContentRange(node);
		expect(range).toEqual({ start: 4, end: 9 });
	});

	it('heading with leading indent', () => {
		const node: CstNode = {
			kind: 'heading',
			leadingTrivia: '',
			raw: '  ## Hello\n',
			metadata: { level: 2 }
		};
		const range = getContentRange(node);
		expect(range).toEqual({ start: 5, end: 10 });
	});

	it('setext heading single line', () => {
		const node: CstNode = {
			kind: 'setextHeading',
			leadingTrivia: '',
			raw: 'Hello World\n===\n',
			metadata: { level: 1 }
		};
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 11 });
	});

	it('setext heading multi-line', () => {
		const node: CstNode = {
			kind: 'setextHeading',
			leadingTrivia: '',
			raw: 'Hello\nWorld\n===\n',
			metadata: { level: 1 }
		};
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 11 });
	});

	it('paragraph without trailing newline', () => {
		const node: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello' };
		const range = getContentRange(node);
		expect(range).toEqual({ start: 0, end: 5 });
	});
});

describe('getContentRange → parseInline offset threading', () => {
	it('heading content range yields inline nodes with raw-absolute offsets', () => {
		const raw = '## Hello `code` world\n';
		const range = getContentRange({
			kind: 'heading',
			leadingTrivia: '',
			raw,
			metadata: { level: 2 }
		});
		const nodes = parseInline(raw, range.start, range.end);
		expect(nodes[0]).toEqual({ kind: 'text', start: 3, end: 9, text: 'Hello ' });
		expect(nodes[1]).toEqual({ kind: 'inlineCode', start: 9, end: 15, text: 'code' });
		expect(nodes[2]).toEqual({ kind: 'text', start: 15, end: 21, text: ' world' });
	});
});
