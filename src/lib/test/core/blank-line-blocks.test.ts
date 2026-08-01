import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { roundTripCases } from '$lib/test/support/round-trip';

// Miss-analysis (blank-line reload loss): a shape assertion over the Enter-split bytes would
// have caught it — the round-trip suites asserted bytes, which the trivia fold preserves.

type Layout = [kind: string, leadingTrivia: string, raw: string];

const layout = (nodes: readonly CstNode[]): Layout[] =>
	nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);

// ── The separator rule ───────────────────────────────────────────────────────

describe('one blank line separates; the rest are blocks', () => {
	it('reloads the Enter-typed "1\\n\\n\\n2\\n" as three blocks', () => {
		expect(layout(parse('1\n\n\n2\n').children)).toEqual([
			['paragraph', '', '1\n'],
			['paragraph', '\n', '\n'],
			['paragraph', '', '2\n']
		]);
	});

	it('leaves the canonical single-blank document at two blocks', () => {
		expect(layout(parse('a\n\nb\n').children)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', 'b\n']
		]);
	});

	it('materializes every blank past the first in a long run', () => {
		const doc = parse('a\n\n\n\n\nb\n');
		expect(doc.children.map((n) => n.raw)).toEqual(['a\n', '\n', '\n', '\n', 'b\n']);
		expect(doc.children.map((n) => n.leadingTrivia)).toEqual(['', '\n', '', '', '']);
	});

	it('keeps a whitespace-only blank line byte-for-byte in its own raw', () => {
		expect(layout(parse('a\n\n  \t \nb\n').children)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', '  \t \n'],
			['paragraph', '', 'b\n']
		]);
	});

	it('takes the run’s FIRST line as the separator, whatever its bytes', () => {
		expect(layout(parse('a\n  \n\nb\n').children)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '  \n', '\n'],
			['paragraph', '', 'b\n']
		]);
	});

	it('carries the authored CRLF into the materialized block', () => {
		expect(layout(parse('1\r\n\r\n\r\n2\r\n').children)).toEqual([
			['paragraph', '', '1\r\n'],
			['paragraph', '\r\n', '\r\n'],
			['paragraph', '', '2\r\n']
		]);
	});
});

// ── Document head and tail ───────────────────────────────────────────────────

describe('document-leading and -trailing runs', () => {
	it('materializes a leading run in full — no preceding block to separate from', () => {
		const doc = parse('\n\na\n');
		expect(doc.prefix).toBe('');
		expect(layout(doc.children)).toEqual([
			['paragraph', '', '\n'],
			['paragraph', '', '\n'],
			['paragraph', '', 'a\n']
		]);
	});

	it('reloads the Enter-typed "1\\n\\n\\n" as two blocks, suffix emptied', () => {
		const doc = parse('1\n\n\n');
		expect(doc.suffix).toBe('');
		expect(layout(doc.children)).toEqual([
			['paragraph', '', '1\n'],
			['paragraph', '\n', '\n']
		]);
	});

	it('keeps a lone trailing blank as the suffix', () => {
		const doc = parse('1\n\n');
		expect(doc.suffix).toBe('\n');
		expect(doc.children).toHaveLength(1);
	});

	it('turns an all-blank document into one block per line', () => {
		const doc = parse('\n\n\n');
		expect(doc.prefix).toBe('');
		expect(doc.suffix).toBe('');
		expect(doc.children.map((n) => n.raw)).toEqual(['\n', '\n', '\n']);
	});

	it('leaves the empty document childless', () => {
		expect(parse('').children).toHaveLength(0);
	});

	it('keeps an unterminated trailing blank line in the block’s raw', () => {
		const doc = parse('a\n\n   ');
		expect(doc.suffix).toBe('');
		expect(layout(doc.children)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', '   ']
		]);
	});
});

// ── Containers inherit the rule through strip-and-recurse ────────────────────

describe('blank runs inside containers', () => {
	it('materializes inside a blockquote', () => {
		const bq = parse('> a\n>\n>\n> b\n').children[0];
		expect(bq.innerPrefix).toBe('');
		expect(bq.innerSuffix).toBe('');
		expect(layout(bq.children!)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', '\n'],
			['paragraph', '', 'b\n']
		]);
	});

	it('materializes a blockquote’s leading blank line', () => {
		const bq = parse('>\n> a\n').children[0];
		expect(bq.innerPrefix).toBe('');
		expect(layout(bq.children!)).toEqual([
			['paragraph', '', '\n'],
			['paragraph', '', 'a\n']
		]);
	});

	it('materializes inside a list item', () => {
		const item = parse('- a\n\n\n  b\n').children[0].children![0];
		expect(layout(item.children!)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', '\n'],
			['paragraph', '', 'b\n']
		]);
	});

	it('leaves a loose list item’s single blank as the separator', () => {
		const item = parse('- a\n\n  b\n').children[0].children![0];
		expect(layout(item.children!)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', 'b\n']
		]);
	});
});

// ── Blank lines the surrounding block owns are untouched ─────────────────────

describe('blanks a block absorbs stay inside its raw', () => {
	it.each([
		['fenced code', '```\na\n\n\nb\n```\n'],
		['indented code', '    a\n\n\n    b\n'],
		['html block', '<script>\n\n\n</script>\n']
	])('%s stays one block', (_label, source) => {
		expect(parse(source).children).toHaveLength(1);
	});

	it('a blank-terminated html block still separates from the next one', () => {
		// CommonMark §4.6: a blank line ends a type-6 block, so the run is between blocks.
		expect(parse('<div>\n\n\n</div>\n').children.map((n) => n.kind)).toEqual([
			'htmlBlock',
			'paragraph',
			'htmlBlock'
		]);
	});
});

describe('materialized blank lines round-trip', () => {
	roundTripCases([
		'1\n\n\n2\n',
		'\n\n\na\n',
		'a\n\n\n\n\n',
		'a\n \n\t\n  \nb\n',
		'> a\n>\n>\n>\n> b\n',
		'- a\n\n\n  b\n',
		'1\r\n\r\n\r\n2\r\n'
	]);
});

describe('the materialized shape is a fixed point of serialize → parse', () => {
	it.each(['1\n\n\n2\n', '\n\n\na\n', 'a\n\n\n\n\n', '> a\n>\n>\n>\n> b\n', '- a\n\n\n  b\n'])(
		'reparsing %j reproduces the same layout',
		(source) => {
			const once = parse(source);
			const twice = parse(serialize(once));
			expect(layout(twice.children)).toEqual(layout(once.children));
		}
	);
});
