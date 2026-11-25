// @vitest-environment node
// Every footnote source in 0.11.5's corpus, read through an editor listing `footnotes`: each read is
// 0.11.5's, kinds named `definition` and `ref`, but for two the editor's core reads as links, as
// GitHub does (a reference followed by a destination, or by a defined label).
// Miss-analysis: the package's reads were held only by its own opener's rows, so nothing compared
// what an editor running the plugin value reads with what 0.11.5 read.
import { describe, expect, it } from 'vitest';
import { grammar, type Block, type Piece } from '#lib/plugin.js';
import { footnotes } from '#packages/footnotes/src/index.js';

type Read = [kind: string, text: string, inside: unknown[]];

const KIND: Record<string, string> = {
	'footnotes/definition': 'definition',
	'footnotes/ref': 'ref'
};
const name = (kind: string) => KIND[kind] ?? kind;

/** A piece as 0.11.5's corpus wrote it: its kind and its bytes inside its block. */
const pieces = (list: readonly Piece[], at: number): unknown[] =>
	list
		.filter((piece) => piece.kind !== 'text')
		.map((piece) => [name(piece.kind), piece.from - at, piece.to - at, pieces(piece.children, at)]);

const blocks = (list: readonly Block[]): Read[] =>
	list.map((block) =>
		block.children.length
			? [name(block.type.name), block.text, blocks(block.children)]
			: [name(block.type.name), block.text, pieces(block.pieces, block.from)]
	);

/** 0.11.5's reads, as its corpus wrote them. */
const READS: [string, Read[]][] = [
	[
		'[^1]: A\n\n    B\n',
		[
			[
				'definition',
				'[^1]: A\n\n    B\n',
				[
					['paragraph', 'A\n', []],
					['paragraph', 'B\n', []]
				]
			]
		]
	],
	[
		'[^1]: A footnote definition.\n    with an indented continuation.\n',
		[
			[
				'definition',
				'[^1]: A footnote definition.\n    with an indented continuation.\n',
				[['paragraph', 'A footnote definition.\nwith an indented continuation.\n', []]]
			]
		]
	],
	['[^a b]: x\n', [['paragraph', '[^a b]: x\n', []]]],
	['[^1]:\n', [['definition', '[^1]:\n', [['paragraph', '\n', []]]]]],
	['para\n[^1]: x\n', [['paragraph', 'para\n[^1]: x\n', [['ref', 5, 9, []]]]]],
	['[^1]: x\nlazy\n', [['definition', '[^1]: x\nlazy\n', [['paragraph', 'x\nlazy\n', []]]]]],
	[
		'[^1]: x\n\n  not\n',
		[
			['definition', '[^1]: x\n', [['paragraph', 'x\n', []]]],
			['paragraph', '  not\n', []]
		]
	],
	[
		'> [^1]: A\n>\n>     B\n',
		[
			[
				'blockquote',
				'> [^1]: A\n>\n>     B\n',
				[
					[
						'definition',
						'[^1]: A\n\n    B\n',
						[
							['paragraph', 'A\n', []],
							['paragraph', 'B\n', []]
						]
					]
				]
			]
		]
	],
	[
		'[^1]: - item\n    - item2\n',
		[
			[
				'definition',
				'[^1]: - item\n    - item2\n',
				[
					[
						'list',
						'- item\n- item2\n',
						[
							['listItem', '- item\n', [['paragraph', 'item\n', []]]],
							['listItem', '- item2\n', [['paragraph', 'item2\n', []]]]
						]
					]
				]
			]
		]
	],
	[
		'[^x]: a\n[^y]: b\n',
		[
			['definition', '[^x]: a\n', [['paragraph', 'a\n', []]]],
			['definition', '[^y]: b\n', [['paragraph', 'b\n', []]]]
		]
	],
	[
		'[ref]: /u\n[^1]: x\n',
		[
			['linkReferenceDefinition', '[ref]: /u\n', []],
			['definition', '[^1]: x\n', [['paragraph', 'x\n', []]]]
		]
	],
	['   [^1]: x\n', [['definition', '   [^1]: x\n', [['paragraph', 'x\n', []]]]]],
	['[^1]: x\n\ttab\n', [['definition', '[^1]: x\n\ttab\n', [['paragraph', 'x\ntab\n', []]]]]],
	[
		'[^1]: x\n    # head\n',
		[
			[
				'definition',
				'[^1]: x\n    # head\n',
				[
					['paragraph', 'x\n', []],
					['heading', '# head\n', []]
				]
			]
		]
	],
	[
		'see [^a] and [^b]\n',
		[
			[
				'paragraph',
				'see [^a] and [^b]\n',
				[
					['ref', 4, 8, []],
					['ref', 13, 17, []]
				]
			]
		]
	],
	['[^note]\n', [['paragraph', '[^note]\n', [['ref', 0, 7, []]]]]],
	['[^]\n', [['paragraph', '[^]\n', []]]],
	['[^ spaced]\n', [['paragraph', '[^ spaced]\n', []]]],
	['[^unterminated\n', [['paragraph', '[^unterminated\n', []]]],
	[
		'a [link [^ ] here](https://x.dev)\n',
		[['paragraph', 'a [link [^ ] here](https://x.dev)\n', [['link', 2, 33, []]]]]
	],
	['[^1](x)\n', [['paragraph', '[^1](x)\n', [['link', 0, 7, []]]]]],
	[
		'[^1][ref]\n\n[ref]: /u\n',
		[
			['paragraph', '[^1][ref]\n', [['link', 0, 9, []]]],
			['linkReferenceDefinition', '[ref]: /u\n', []]
		]
	],
	['`[^1]`\n', [['paragraph', '`[^1]`\n', [['inlineCode', 0, 6, []]]]]],
	['*[^1]*\n', [['paragraph', '*[^1]*\n', [['emphasis', 0, 6, [['ref', 1, 5, []]]]]]]],
	['x[^a]y\n', [['paragraph', 'x[^a]y\n', [['ref', 1, 5, []]]]]],
	['[^a\nb]\n', [['paragraph', '[^a\nb]\n', []]]],
	['[^é]\n', [['paragraph', '[^é]\n', [['ref', 0, 4, []]]]]],
	['# Head [^1]\n', [['heading', '# Head [^1]\n', [['ref', 7, 11, []]]]]],
	[
		'| a |\n| - |\n| [^1] |\n',
		[
			[
				'table',
				'| a |\n| - |\n| [^1] |\n',
				[
					['tableRow', '| a |\n', [['tableCell', 'a', []]]],
					['tableRow', '| [^1] |\n', [['tableCell', '[^1]', [['ref', 0, 4, []]]]]]
				]
			]
		]
	]
];

describe('footnote sources read as 0.11.5 read them', () => {
	it.each(READS)('%j', (source, read) => {
		expect(blocks(grammar([footnotes]).parse(source).blocks)).toEqual(read);
	});
});
