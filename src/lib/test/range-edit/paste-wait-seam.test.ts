// @vitest-environment jsdom
// A block a paste sets beside a neighbour keeps its reading where a block above still waits (a
// definition whose title has started), as a removal's join does: a blank line parts the two.
// Miss-analysis: a paste asked each pair of blocks it leaves touching alone, and no paste row
// stood under a wait.
import { describe, expect, it } from 'vitest';
import type { NodeView } from '#lib/core/node-views.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeOf, unmark } from './named-rows';
import { checkHost } from './test-host';

const kinds = (nodes: readonly NodeView[]): string =>
	nodes.map((n) => (n.children ? `${n.kind}(${kinds(n.children)})` : n.kind)).join(' ');

const ROWS: [name: string, marked: string, clip: string, left: string, blocks: string][] = [
	[
		'a definition pasted over a heading’s text',
		"[a]: /u\n    'code\n# ⟦h⟧\ntext\nend'\n",
		'[c]: /w',
		"[a]: /u\n    'code\n\n[c]: /w\ntext\nend'\n",
		'linkReferenceDefinition indentedCode linkReferenceDefinition paragraph'
	],
	[
		'the same inside a quote',
		"> [a]: /u\n>     'code\n> # ⟦h⟧\n> text\n> end'\n",
		'[c]: /w',
		"> [a]: /u\n>     'code\n>\n> [c]: /w\n> text\n> end'\n",
		'blockquote(linkReferenceDefinition indentedCode linkReferenceDefinition paragraph)'
	],
	[
		'a definition pasted on the empty line between',
		"[a]: /u\n    'code\n⟦⟧\ntext\nend'\n",
		'[c]: /w',
		"[a]: /u\n    'code\n\n[c]: /w\ntext\nend'\n",
		'linkReferenceDefinition indentedCode linkReferenceDefinition paragraph'
	],
	[
		'the same inside a quote',
		"> [a]: /u\n>     'code\n> ⟦⟧\n> text\n> end'\n",
		'[c]: /w',
		"> [a]: /u\n>     'code\n>\n> [c]: /w\n> text\n> end'\n",
		'blockquote(linkReferenceDefinition indentedCode linkReferenceDefinition paragraph)'
	],
	[
		'a quote the title can’t close through takes the line flush',
		"[a]: /u\n    'code\n# ⟦h⟧\ntext\nend'\n",
		'> q',
		"[a]: /u\n    'code\n> q\n\ntext\nend'\n",
		'linkReferenceDefinition indentedCode blockquote(paragraph) paragraph'
	]
];

describe('the seam a paste leaves under a wait', () => {
	for (const mode of ['source', 'live'] as const) {
		it.each(ROWS)(`${mode}: %s`, (_, marked, clip, left, blocks) => {
			const host = { ...checkHost(), transformPaste: (text: string) => text };
			const gesture = { paste: clip, plain: false, holds: 'text' } as const;
			const got = editRange(unmark(marked), rangeOf(marked), gesture, mode, host);
			expect(got.source).toBe(left);
			expect(kinds(host.read(got.source).children)).toBe(blocks);
		});
	}
});
