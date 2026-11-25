// @vitest-environment node
// Every alert and `:::` source in 0.11.5's corpus, read through an editor listing `admonitions`:
// each read is 0.11.5's, kinds named `alert` and `admonition`.
// Miss-analysis: the package's reads were held only by its own opener's rows, so nothing compared
// what an editor running the plugin value reads with what 0.11.5 read.
import { describe, expect, it } from 'vitest';
import { parse, type CstNode } from '#lib';
import { grammar } from '#lib/plugin.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { admonitionsGrammar } from '#lib/test/support/admonitions-grammar.js';

type Read = [kind: string, raw: string, inside: Read[]];

const KIND: Record<string, string> = {
	'admonitions/admonition': 'admonition',
	'admonitions/alert': 'alert'
};

const blocks = (list: readonly CstNode[]): Read[] =>
	list.map((node) => [KIND[node.kind] ?? node.kind, node.raw, blocks(node.children ?? [])]);

/** 0.11.5's reads, as its corpus wrote them. */
const READS: [string, Read[]][] = [
	[
		'> [!NOTE]\n> Heads up.\n',
		[['alert', '> [!NOTE]\n> Heads up.\n', [['paragraph', 'Heads up.\n', []]]]]
	],
	[
		'> [!note]\n> a\n>\n> b\n',
		[
			[
				'alert',
				'> [!note]\n> a\n>\n> b\n',
				[
					['paragraph', 'a\n', []],
					['paragraph', 'b\n', []]
				]
			]
		]
	],
	['> [!TIP]\n', [['alert', '> [!TIP]\n', []]]],
	['> [!NOPE]\n> x\n', [['blockquote', '> [!NOPE]\n> x\n', [['paragraph', '[!NOPE]\nx\n', []]]]]],
	[
		'para\n> [!NOTE]\n> x\n',
		[
			['paragraph', 'para\n', []],
			['alert', '> [!NOTE]\n> x\n', [['paragraph', 'x\n', []]]]
		]
	],
	['> [!NOTE]\nlazy\n', [['alert', '> [!NOTE]\nlazy\n', [['paragraph', 'lazy\n', []]]]]],
	[
		'> > [!NOTE]\n> > A\n',
		[
			[
				'blockquote',
				'> > [!NOTE]\n> > A\n',
				[['alert', '> [!NOTE]\n> A\n', [['paragraph', 'A\n', []]]]]
			]
		]
	],
	[
		'- > [!WARNING]\n  > x\n',
		[
			[
				'list',
				'- > [!WARNING]\n  > x\n',
				[
					[
						'listItem',
						'- > [!WARNING]\n  > x\n',
						[['alert', '> [!WARNING]\n> x\n', [['paragraph', 'x\n', []]]]]
					]
				]
			]
		]
	],
	[
		'> [!NOTE] title\n> x\n',
		[['blockquote', '> [!NOTE] title\n> x\n', [['paragraph', '[!NOTE] title\nx\n', []]]]]
	],
	['  > [!CAUTION]\n  > x\n', [['alert', '  > [!CAUTION]\n  > x\n', [['paragraph', 'x\n', []]]]]],
	['    > [!NOTE]\n', [['indentedCode', '    > [!NOTE]\n', []]]],
	['> [!NOTE]\r\n> x\r\n', [['alert', '> [!NOTE]\r\n> x\r\n', [['paragraph', 'x\r\n', []]]]]],
	[
		'> [!IMPORTANT]\n> a\n\n> [!IMPORTANT]\n> b\n',
		[
			['alert', '> [!IMPORTANT]\n> a\n', [['paragraph', 'a\n', []]]],
			['alert', '> [!IMPORTANT]\n> b\n', [['paragraph', 'b\n', []]]]
		]
	],
	[
		':::note Heads up\n\nbody\n\n:::\n',
		[
			[
				'admonition',
				':::note Heads up\n\nbody\n\n:::\n',
				[
					['directiveOpenerLine', ':::note Heads up\n', []],
					['paragraph', 'body\n', []]
				]
			]
		]
	],
	[
		'::::note Outer\n:::tip Inner\nA\n\nB\n:::\n::::\n',
		[
			[
				'admonition',
				'::::note Outer\n:::tip Inner\nA\n\nB\n:::\n::::\n',
				[
					['directiveOpenerLine', '::::note Outer\n', []],
					[
						'admonition',
						':::tip Inner\nA\n\nB\n:::\n',
						[
							['directiveOpenerLine', ':::tip Inner\n', []],
							['paragraph', 'A\n', []],
							['paragraph', 'B\n', []]
						]
					]
				]
			]
		]
	],
	[
		':::spoiler\nx\n:::\n',
		[
			[
				'directiveContainer',
				':::spoiler\nx\n:::\n',
				[
					['directiveOpenerLine', ':::spoiler\n', []],
					['paragraph', 'x\n', []]
				]
			]
		]
	],
	[
		':::NOTE\nx\n:::\n',
		[
			[
				'directiveContainer',
				':::NOTE\nx\n:::\n',
				[
					['directiveOpenerLine', ':::NOTE\n', []],
					['paragraph', 'x\n', []]
				]
			]
		]
	]
];

describe('alert and `:::` sources read as 0.11.5 read them', () => {
	it.each(READS)('%j', (source, read) => {
		expect(blocks(parse(source, { grammar: admonitionsGrammar() }).children)).toEqual(read);
	});
});

// The published read hands a lone head line the empty paragraph a caret needs, as the editor 0.11.5
// mounted did; 0.11.5's page-wide read had none.
it('a lone head line reads with an empty paragraph through `grammar`', () => {
	const [alert] = grammar([admonitions]).parse('> [!TIP]\n').blocks;
	expect([alert.type.name, alert.children.map((child) => [child.type.name, child.text])]).toEqual([
		'admonitions/alert',
		[['paragraph', '\n']]
	]);
});
