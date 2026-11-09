// @vitest-environment jsdom
// A removal's tail after a block a bare line reads on into (an HTML block a blank line ends, a
// table, a definition open to a title) keeps a blank line, and an end block taken whole goes with
// its line. Miss-analysis: the laws hold bytes, not the blocks they read as, and draw no HTML block.
import { describe, expect, it } from 'vitest';
import type { NodeView } from '#lib/core/node-views.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeOf, unmark } from './named-rows';
import { checkHost } from './test-host';

const kinds = (nodes: readonly NodeView[]): string =>
	nodes.map((n) => (n.children ? `${n.kind}(${kinds(n.children)})` : n.kind)).join(' ');

const ROWS: [name: string, marked: string, left: string, blocks: string][] = [
	[
		'an HTML block a blank line ends',
		'<div>\nx\n</div>⟦\n\nal⟧pha\n',
		'<div>\nx\n</div>\n\npha\n',
		'htmlBlock paragraph'
	],
	['from inside its text', '<div>\nx⟦\n\nal⟧pha\n', '<div>\nx\n\npha\n', 'htmlBlock paragraph'],
	[
		'into a heading',
		'<div>\nx\n</div>⟦\n\n# He⟧ad\n',
		'<div>\nx\n</div>\n\n# ad\n',
		'htmlBlock heading'
	],
	[
		'inside a quote, out of it',
		'> <div>\n> x⟦\n\nal⟧pha\n',
		'> <div>\n> x\n\npha\n',
		'blockquote(htmlBlock) paragraph'
	],
	[
		'inside a quote, the tail in it too',
		'> <div>\n> x⟦\n>\n> al⟧pha\n',
		'> <div>\n> x\n>\n> pha\n',
		'blockquote(htmlBlock paragraph)'
	],
	[
		'an HTML comment, closed on its line, keeps no blank line',
		'<!-- c -->⟦\n\nal⟧pha\n',
		'<!-- c -->\npha\n',
		'htmlBlock paragraph'
	],
	[
		'a definition with no title yet',
		'[x]: /u⟦\n\nx⟧"t"\n',
		'[x]: /u\n\n"t"\n',
		'linkReferenceDefinition paragraph'
	],
	[
		'a table, its last row',
		'| a |\n| - |\n| 1 |⟦\n\nal⟧pha\n',
		'| a |\n| - |\n| 1 |\n\npha\n',
		'table(tableRow(tableCell) tableRow(tableCell)) paragraph'
	],
	[
		'a code block to the end of a rule adds no line ending',
		'```\nx\n```⟦\n\n---⟧\n\nb\n',
		'```\nx\n```\n\nb\n',
		'fencedCode paragraph'
	],
	[
		'an HTML block to the end of a rule adds no line ending either',
		'<div>\nx\n</div>⟦\n\n---⟧\n\nb\n',
		'<div>\nx\n</div>\n\nb\n',
		'htmlBlock paragraph'
	]
];

describe('a removal after a block a bare line reads on into', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const gesture of ['backspace', 'delete', 'cut'] as const) {
			it.each(ROWS)(`${mode}, ${gesture}: %s`, (_, marked, left, blocks) => {
				const host = checkHost();
				const got = editRange(unmark(marked), rangeOf(marked), gesture, mode, host);
				expect(got.source).toBe(left);
				expect(kinds(host.read(got.source).children)).toBe(blocks);
			});
		}
	}
});
