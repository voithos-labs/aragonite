import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { layoutOf, triviaRawOf } from '$lib/test/harness/parse-converged';

// A whitespace-only line indented to a body's content column belongs to that body; a bare blank
// line still ends it (GH #406). The second test file for the class is
// `tree-operations/indented-body-tail-blank.test.ts`, which blanks a body's last block.

beforeAll(() => {
	installPlugins([footnotesPlugin()]);
});

describe('an indented blank line inside a list item', () => {
	it.each([
		['LF', '- a\n\n  \n- c\n', '\n'],
		['CRLF', '- a\r\n\r\n  \r\n- c\r\n', '\r\n']
	])('after a bare separator reads as an empty paragraph child (%s)', (_, source, eol) => {
		const doc = parse(source);

		expect(serialize(doc)).toBe(source);
		expect(doc.children.map((c) => c.kind)).toEqual(['list']);
		const [first, second] = doc.children[0].children!;
		expect(triviaRawOf(first.children!)).toEqual([
			['', 'a' + eol],
			[eol, eol]
		]);
		expect(triviaRawOf(second.children!)).toEqual([['', 'c' + eol]]);
	});

	it('as the only line after the paragraph is the body’s trailing separator', () => {
		const doc = parse('- a\n  \n- c\n');

		const item = doc.children[0].children![0];
		expect(triviaRawOf(item.children!)).toEqual([['', 'a\n']]);
		expect(item.innerSuffix).toBe('\n');
		expect(doc.children[0].children).toHaveLength(2);
	});

	it.each([
		['LF', '- a\n\n\n- c\n', '\n'],
		['CRLF', '- a\r\n\r\n\r\n- c\r\n', '\r\n']
	])('a bare blank run between items still ends the list (%s)', (_, source, eol) => {
		expect(layoutOf(parse(source).children)).toEqual([
			['list', '', '- a' + eol],
			['paragraph', eol, eol],
			['list', '', '- c' + eol]
		]);
	});
});

describe('an indented blank line inside a footnote definition', () => {
	it.each([
		['LF', '[^1]: a\n\n    \n', '\n'],
		['CRLF', '[^1]: a\r\n\r\n    \r\n', '\r\n']
	])('after a bare separator reads as an empty paragraph child (%s)', (_, source, eol) => {
		const doc = parse(source);

		expect(serialize(doc)).toBe(source);
		expect(doc.children).toHaveLength(1);
		expect(triviaRawOf(doc.children[0].children!)).toEqual([
			['', 'a' + eol],
			[eol, eol]
		]);
	});

	it('a bare blank run after the definition stays the document’s', () => {
		const doc = parse('[^1]: a\n\n\n');

		expect(doc.children[0].raw).toBe('[^1]: a\n');
		expect(triviaRawOf(doc.children[0].children!)).toEqual([['', 'a\n']]);
	});
});
