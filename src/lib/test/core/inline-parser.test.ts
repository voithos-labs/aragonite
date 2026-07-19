import { describe, it, expect } from 'vitest';
import { getContentRange, parseInline } from '../../core/inline';
import type { InlineNode } from '../../core/nodes';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

describe('parseInline — backtick spans', () => {
	it('plain text with no markup', () => {
		const nodes = inlineOf('Hello world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 11, text: 'Hello world' }]);
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
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 12, text: 'Hello `world' }]);
	});

	it('backtick length mismatch is plain text', () => {
		const nodes = inlineOf('Hello ``code` world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 19, text: 'Hello ``code` world' }]);
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

	it('backslash-escaped opening backtick does not start a code span (CommonMark §6.1)', () => {
		const nodes = inlineOf('\\`not code\\`');
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(2);
	});

	it('two backslashes before a backtick: backslash escapes itself, code span opens', () => {
		// Even backslash count → not escaped → backtick opens a span.
		const nodes = inlineOf('\\\\`code`');
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('content-offset: heading raw with offset', () => {
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

	it('round-trip: concatenating inline nodes reproduces content', () => {
		const content = 'Hello `code` **not parsed yet** world';
		const nodes = inlineOf(content);
		const reconstructed = nodes.map((n) => content.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(content);
	});
});

describe('parseInline — emphasis and strong', () => {
	const emphasisChars = ['*', '_'] as const;

	for (const ch of emphasisChars) {
		it(`simple emphasis with ${ch}`, () => {
			const nodes = inlineOf(`Hello ${ch}world${ch}`);
			expect(nodes.length).toBe(2);
			expect(nodes[0]).toEqual({ kind: 'text', start: 0, end: 6, text: 'Hello ' });
			expect(nodes[1].kind).toBe('emphasis');
			expect(nodes[1].start).toBe(6);
			expect(nodes[1].end).toBe(13);
			expect(nodes[1].children).toEqual([{ kind: 'text', start: 7, end: 12, text: 'world' }]);
		});
	}

	it('strong with **', () => {
		const nodes = inlineOf('Hello **world**');
		expect(nodes[1].kind).toBe('strong');
		expect(nodes[1].start).toBe(6);
		expect(nodes[1].end).toBe(15);
		expect(nodes[1].children).toEqual([{ kind: 'text', start: 8, end: 13, text: 'world' }]);
	});

	it('nested strong inside emphasis', () => {
		const nodes = inlineOf('*Hello **world***');
		expect(nodes[0].kind).toBe('emphasis');
		expect(nodes[0].children!.length).toBe(2);
		expect(nodes[0].children![0]).toEqual({ kind: 'text', start: 1, end: 7, text: 'Hello ' });
		expect(nodes[0].children![1].kind).toBe('strong');
	});

	it('unmatched * is plain text', () => {
		const nodes = inlineOf('Hello *world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 12, text: 'Hello *world' }]);
	});

	it('emphasis does not cross inline code', () => {
		const nodes = inlineOf('*hello `code* end` world*');
		function hasKind(ns: InlineNode[], kind: string): boolean {
			return ns.some((n) => n.kind === kind || (n.children ? hasKind(n.children, kind) : false));
		}
		expect(hasKind(nodes, 'inlineCode')).toBe(true);
	});

	it('round-trip: inline nodes cover entire content', () => {
		const content = 'Hello **bold *nested*** end';
		const nodes = inlineOf(content);
		const reconstructed = nodes.map((n) => content.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(content);
	});
});

describe('parseInline — strikethrough', () => {
	it('simple strikethrough', () => {
		const nodes = inlineOf('Hello ~~world~~ end');
		expect(nodes[1].kind).toBe('strikethrough');
		expect(nodes[1].children).toEqual([{ kind: 'text', start: 8, end: 13, text: 'world' }]);
	});

	const rejectedTildes = [
		{ label: 'single ~', input: 'Hello ~world~ end' },
		{ label: 'triple ~', input: 'Hello ~~~world~~~ end' }
	];

	for (const { label, input } of rejectedTildes) {
		it(`${label} is not strikethrough`, () => {
			const nodes = inlineOf(input);
			expect(nodes.every((n) => n.kind === 'text')).toBe(true);
		});
	}
});

describe('parseInline — hard line breaks', () => {
	it('backslash before newline', () => {
		const nodes = inlineOf('Hello\\\nworld');
		const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
		expect(breakNode).toBeDefined();
		expect(breakNode!.start).toBe(5);
	});

	it('two spaces before newline', () => {
		const nodes = inlineOf('Hello  \nworld');
		const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
		expect(breakNode).toBeDefined();
	});

	it('single space before newline is not a break', () => {
		const nodes = inlineOf('Hello \nworld');
		const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
		expect(breakNode).toBeUndefined();
	});

	it('CRLF backslash hard line break', () => {
		const input = 'line1\\\r\nline2';
		const nodes = inlineOf(input);
		const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
		expect(breakNode).toBeDefined();
		expect(breakNode!.start).toBe(5);
		expect(breakNode!.end).toBe(8);
		const textNodes = nodes.filter((n) => n.kind === 'text');
		expect(textNodes[0]).toEqual({ kind: 'text', start: 0, end: 5, text: 'line1' });
		expect(textNodes[1]).toEqual({ kind: 'text', start: 8, end: 13, text: 'line2' });
	});

	it('CRLF two spaces before newline', () => {
		const input = 'line1  \r\nline2';
		const nodes = inlineOf(input);
		const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
		expect(breakNode).toBeDefined();
		expect(breakNode!.start).toBe(5);
		expect(breakNode!.end).toBe(9);
	});
});
