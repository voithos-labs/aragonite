/**
 * A built-in block's `data` as a plugin reads it, typed per kind from what the tree holds: a heading
 * narrowed with `is` reads `data.level` as a number, read-only, and each kind's typed fields are the
 * ones its block carries. The `@ts-expect-error` lines are assertions `npm run check` holds.
 * Miss-analysis: no row read a built-in's data through its type, so the table typed it `never`.
 */
import { describe, expect, it } from 'vitest';
import { builtin, grammar, type Block, type BlockType } from '#lib/plugin.js';
import { makeBlockNode, type BlockKind } from '#lib/core/nodes.js';
import { DETACHED_READING, makeBlock } from '#lib/schema/doc-view.js';

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never called: an outside author's reads, written as they would against `/plugin`.
export const typePins = (block: Block): void => {
	if (block.is(builtin.blocks.heading)) {
		const level: number = block.data.level;
		// @ts-expect-error a level is a number
		const spelled: string = block.data.level;
		// @ts-expect-error the data is the tree's own, so a write would change it under its bytes
		block.data.level = 2;
		void [level, spelled];
	}
	if (block.is(builtin.blocks.heading) || block.is(builtin.blocks.setextHeading)) {
		const level: number = block.data.level;
		void level;
	}
	if (block.is(builtin.blocks.table)) {
		// @ts-expect-error nor can a table's alignments be pushed to
		block.data.alignments.push('left');
	}
	if (block.is(builtin.blocks.paragraph)) {
		const nothing: undefined = block.data;
		// @ts-expect-error a paragraph carries no data
		void block.data.level;
		void nothing;
	}
};

// ── What each kind carries ──────────────────────────────────────────────────

type DataOf<K extends BlockKind> =
	(typeof builtin.blocks)[K] extends BlockType<infer D> ? D : never;

// A document per kind and what its last block of that kind holds, typed by the table: a field the
// type lacks fails to compile, and one the block holds that the type lacks fails the row.
const CARRIES: { [K in BlockKind]: { source: string | null; data: DataOf<K> } } = {
	heading: { source: '### Three\n', data: { level: 3 } },
	setextHeading: { source: 'Two\n---\n', data: { level: 2 } },
	paragraph: { source: 'plain\n', data: undefined },
	fencedCode: {
		source: '~~~~ js\nx\n',
		data: { fenceMarker: '~', fenceLength: 4, info: 'js', closed: false }
	},
	thematicBreak: { source: '***\n', data: { marker: '*' } },
	indentedCode: { source: '    code\n', data: undefined },
	htmlBlock: { source: '<div>\n</div>\n', data: undefined },
	linkReferenceDefinition: {
		source: '[a]: /url "T"\n',
		data: { label: 'a', url: '/url', title: 'T' }
	},
	tableCell: { source: '| a |\n| - |\n| 1 |\n', data: undefined },
	// The parser makes no unrecognized block from text, so its row reads a node made by hand.
	unrecognized: { source: null, data: undefined },
	blockquote: { source: '> quoted\n', data: { quoteDepth: 1 } },
	list: { source: '1. one\n', data: { ordered: true } },
	listItem: {
		source: '- [x] done\n',
		data: { marker: '- ', taskItem: true, taskChecked: true, taskMarker: '[x] ' }
	},
	table: {
		source: '| a | b | c |\n| :- | :-: | - |\n| 1 | 2 | 3 |\n',
		data: { columnCount: 3, alignments: ['left', 'center', 'none'] }
	},
	tableRow: { source: '| a |\n| - |\n| 1 | 2 |\n', data: { isHeader: false, surplusCells: ['2'] } }
};

function lastOfKind(kind: BlockKind, source: string | null): Block {
	if (source === null)
		return makeBlock(
			makeBlockNode({ kind, leadingTrivia: '', raw: 'x\n' }),
			DETACHED_READING,
			null
		);
	const found = [...grammar([]).parse(source).walk()].filter((block) => block.type.name === kind);
	return found[found.length - 1];
}

describe("a built-in block's data", () => {
	it.each(Object.entries(CARRIES) as [BlockKind, (typeof CARRIES)[BlockKind]][])(
		'holds the fields its type names: %s',
		(kind, { source, data }) => {
			const block = lastOfKind(kind, source);
			// A type picked by a kind in hand is one of several, which `is` takes without narrowing.
			expect(block.is(builtin.blocks[kind])).toBe(true);
			expect(block.data).toStrictEqual(data);
		}
	);
});
