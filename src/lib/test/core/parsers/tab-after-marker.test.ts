import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';

// Where the quote and list parsers read a tab right after the marker as one byte, and CommonMark
// reads it as columns to the next multiple of four (the spec's tab examples 6 and 7, checked
// against commonmark.js). Each row pins today's reading and names the spec's, so a fix flips it.

const outline = (nodes: readonly CstNode[] | undefined): unknown[] =>
	(nodes ?? []).map((n) => (n.children ? [n.kind, outline(n.children)] : [n.kind, n.raw]));

describe('a tab after a container marker, read by bytes', () => {
	it.each([
		[
			'`>` then two tabs holds indented code `foo` (the spec reads `  foo`)',
			'>\t\tfoo\n',
			[['blockquote', [['indentedCode', '\tfoo\n']]]]
		],
		[
			'`-` then two tabs holds the paragraph `foo` (the spec reads indented code `  foo`)',
			'-\t\tfoo\n',
			[['list', [['listItem', [['paragraph', 'foo\n']]]]]]
		],
		[
			'`-` then a tab puts the content column at 2 (the spec puts it at 4, leaving `bar` out)',
			'-\tfoo\n\n  bar\n',
			[
				[
					'list',
					[
						[
							'listItem',
							[
								['paragraph', 'foo\n'],
								['paragraph', 'bar\n']
							]
						]
					]
				]
			]
		]
	])('%s', (_, source, tree) => {
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
		expect(outline(doc.children)).toEqual(tree);
	});
});
