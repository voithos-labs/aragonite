// @vitest-environment jsdom
// Two blocks a removal leaves touching keep the readings the fix-up's join question gives them, and
// an end block taken whole goes with its line. Miss-analysis: the laws hold bytes, not the blocks
// they read as, and the pair a removal uncovers had rows on the structural route only.
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
	],
	[
		'a code block keeps its closer and no blank line',
		'```\nx⟦\n```\n\nal⟧pha\n',
		'```\nx\n```\npha\n',
		'fencedCode paragraph'
	],
	[
		'a rule a heading parted from the paragraph above',
		'a\n⟦# h⟧\n---\n',
		'a\n\n---\n',
		'paragraph thematicBreak'
	],
	[
		'the same, from the paragraph’s end',
		'a⟦\n# h⟧\n---\n',
		'a\n\n---\n',
		'paragraph thematicBreak'
	],
	[
		'a table a heading parted from the paragraph above',
		'a⟦\n# h⟧\n| A | B |\n| - | - |\n',
		'a\n\n| A | B |\n| - | - |\n',
		'paragraph table(tableRow(tableCell tableCell))'
	],
	[
		'a rule a heading parted inside a quote',
		'> a\n> ⟦# h⟧\n> ---\n',
		'> a\n>\n> ---\n',
		'blockquote(paragraph thematicBreak)'
	],
	[
		'a table a range out of a quote parted from it',
		'> a⟦b\n\n# h⟧\n| A |\n| - |\n',
		'> a\n\n| A |\n| - |\n',
		'blockquote(paragraph) table(tableRow(tableCell))'
	],
	[
		'a tail taking a heading’s place under a table',
		'| a |\n| - |\n⟦# h\n\nal⟧pha\n',
		'| a |\n| - |\n\npha\n',
		'table(tableRow(tableCell)) paragraph'
	],
	[
		'a tail taking a heading’s place under prose folds in',
		'a\n⟦# h\n\nal⟧pha\n',
		'a\npha\n',
		'paragraph'
	]
];

describe('the join a removal leaves', () => {
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
