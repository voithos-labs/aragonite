import { describe, it, expect } from 'vitest';
import { getContentRange, parseInline } from '../../core/inline';
import type { CstNode, InlineNode } from '../../core/nodes';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

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

describe('parseInline — backtick spans (Stage 1)', () => {
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

describe('parseInline — emphasis and strong (Stage 2)', () => {
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

describe('parseInline — strikethrough (Stage 2)', () => {
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

describe('parseInline — hard line breaks (Stage 2)', () => {
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

describe('parseInline — fast path post-processing (I4)', () => {
	it('fast path output has no adjacent text siblings', () => {
		const input = 'before  \nhttps://example.com after';
		const nodes = inlineOf(input);
		for (let i = 1; i < nodes.length; i++) {
			const prev = nodes[i - 1];
			const cur = nodes[i];
			if (cur.kind === 'text' && prev.kind === 'text') {
				throw new Error(
					`adjacent text nodes at indices ${i - 1}, ${i}: ${JSON.stringify([prev, cur])}`
				);
			}
		}
	});

	it('fast path: text+autolink+text reconstructs raw', () => {
		const input = 'pre https://example.com post';
		const nodes = inlineOf(input);
		const reconstructed = nodes.map((n) => input.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(input);
	});
});

describe('parseInline — links and images (Stage 3)', () => {
	it('simple inline link', () => {
		const nodes = inlineOf('Click [here](https://example.com) now');
		expect(nodes.length).toBe(3);
		expect(nodes[0]).toEqual({ kind: 'text', start: 0, end: 6, text: 'Click ' });
		expect(nodes[1].kind).toBe('link');
		expect(nodes[1].start).toBe(6);
		expect(nodes[1].end).toBe(33);
		expect(nodes[1].url).toBe('https://example.com');
		expect(nodes[1].children!.length).toBe(1);
		expect(nodes[1].children![0]).toEqual({ kind: 'text', start: 7, end: 11, text: 'here' });
	});

	it('link with title', () => {
		const nodes = inlineOf('[text](url "title")');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].url).toBe('url');
		expect(nodes[0].title).toBe('title');
	});

	it('image', () => {
		const nodes = inlineOf('See ![alt text](image.png) here');
		expect(nodes[1].kind).toBe('image');
		expect(nodes[1].alt).toBe('alt text');
		expect(nodes[1].url).toBe('image.png');
	});

	it('link with emphasis in text', () => {
		const nodes = inlineOf('[**bold link**](url)');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].children![0].kind).toBe('strong');
	});

	it('unmatched [ is plain text', () => {
		const nodes = inlineOf('Hello [world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 12, text: 'Hello [world' }]);
	});

	it('link without closing paren is plain text', () => {
		const nodes = inlineOf('[text](url');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});
});

describe('parseInline — autolinks (Stage 3)', () => {
	it('angle-bracket autolink', () => {
		const nodes = inlineOf('Visit <https://example.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('bare URL autolink', () => {
		const nodes = inlineOf('Visit https://example.com now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('non-URL angle brackets are text', () => {
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});
});

describe('parseInline — escape integration', () => {
	it('escape neutralizes emphasis delimiter', () => {
		const raw = '\\*foo\\*';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'emphasis')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(2);
	});

	it('escape inside code span is inert', () => {
		const raw = '`\\*`';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'escape')).toBe(false);
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('escape neutralizes strong delimiter', () => {
		const raw = '\\*\\*foo\\*\\*';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'strong')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(4);
	});

	it('escape and link in same paragraph: emphasis still neutralized', () => {
		const raw = '\\*foo\\* [link](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'emphasis')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(2);
		expect(nodes.some((n) => n.kind === 'link')).toBe(true);
	});
});

describe('parseInline — entity reference integration', () => {
	it('recognizes named entity in plain text', () => {
		const raw = 'a &copy; b';
		const nodes = parseInline(raw, 0, raw.length);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
	});

	it('entity inside code span is inert', () => {
		const raw = '`&copy;`';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'entityReference')).toBe(false);
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('entity composes with surrounding emphasis', () => {
		const raw = '*&copy;*';
		const nodes = parseInline(raw, 0, raw.length);
		const em = nodes.find((n) => n.kind === 'emphasis');
		expect(em).toBeDefined();
		expect(em?.children?.some((c) => c.kind === 'entityReference')).toBe(true);
	});

	it('entity and link in same paragraph: entity preserved', () => {
		const raw = '&copy; [text](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
		expect(nodes.some((n) => n.kind === 'link')).toBe(true);
	});

	it('entity adjacent to autolink URL: entity not absorbed', () => {
		const raw = 'see https://example.com/?a&amp;b end';
		const nodes = parseInline(raw, 0, raw.length);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('&');
	});
});

describe('parseInline — links spanning occupied ranges', () => {
	it('link with entity reference in text', () => {
		const raw = '[&copy; me](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		const entities = links[0].children?.filter((c) => c.kind === 'entityReference');
		expect(entities).toHaveLength(1);
		expect(entities?.[0].decoded).toBe('©');
	});

	it('link with escape in text', () => {
		const raw = '[foo \\*bar\\*](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		const escapes = links[0].children?.filter((c) => c.kind === 'escape');
		expect(escapes).toHaveLength(2);
		const ems = links[0].children?.filter((c) => c.kind === 'emphasis');
		expect(ems).toHaveLength(0);
	});

	it('image with entity in alt text', () => {
		const raw = '![&copy; logo](logo.png)';
		const nodes = parseInline(raw, 0, raw.length);
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
	});

	it('link inside emphasis with entity in link text', () => {
		const raw = '*see [&copy; me](https://example.com) here*';
		const nodes = parseInline(raw, 0, raw.length);
		const ems = nodes.filter((n) => n.kind === 'emphasis');
		expect(ems).toHaveLength(1);
		const links = ems[0].children?.filter((c) => c.kind === 'link');
		expect(links).toHaveLength(1);
	});

	it('autolink still stops at entity boundary (regression guard for 1d44f0f)', () => {
		const raw = 'see https://example.com/?a&amp;b end';
		const nodes = parseInline(raw, 0, raw.length);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});
});
