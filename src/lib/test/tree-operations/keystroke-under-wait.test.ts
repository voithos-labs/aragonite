// @vitest-environment jsdom
// A definition whose title has started waits on the lines under it, so a key in a block below it
// can change the definition. Every route a key takes leaves the tree a reload of its bytes reads.
// Miss-analysis: the fix-up's rows put a closer under an opener a line closes; none put a key under
// a reading no line closes, where the block it changes stands several blocks above the key.
import { describe, it, expect, beforeEach } from 'vitest';
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { CstNode } from '#lib/core/nodes.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { EDITS, judge, leafAt, opened, type Edit } from '#lib/test/exhaustive/edit-driver.js';
import { ALPHABET_PLUGINS } from '#lib/test/exhaustive/alphabet.js';
import { wrapped, type Wrap } from '../invariants/arbitraries/waiting-definition';

const typed = (text: string): Edit => ({
	name: `type ${JSON.stringify(text)}`,
	apply: async (blockEdit: BlockEditActions, index: number, node: CstNode, offset: number) =>
		blockEdit.updateBlockContent(
			index,
			node.raw.slice(0, offset) + text + node.raw.slice(offset),
			'authored',
			'join-typing',
			offset,
			offset + text.length
		)
});
const named = (name: string): Edit => EDITS.find((edit) => edit.name === name)!;
const BACKSPACE = named('delete before');
const DELETE = named('delete after');

const TAIL = ['', 'last'];
/** Where each wrap puts the blocks of the lines it is given. */
const LIST: Record<Wrap, number[]> = { top: [], quote: [0], item: [0, 0] };

/** A row: the lines, the block the key lands in, the text the caret stands after there (none for
 *  the block's start), and the key. */
type Row = [string, string[], number, string, Edit];

const closing = (open: string, close: string): Row[] => [
	[
		`${close} closes a title that started in a code line`,
		['[a]: /u', `    ${open}code`, '[b]: /v', '[b]: /v', 'end', ...TAIL],
		4,
		'end',
		typed(close)
	],
	[
		`${close} closes a title early, over lines a paragraph held`,
		['[a]: /u', `${open}t`, '[b]: /v', '[c]: /w', 'end', ...TAIL],
		1,
		`${open}t`,
		typed(close)
	]
];

const ROWS: Row[] = [
	...closing('"', '"'),
	...closing("'", "'"),
	...closing('(', ')'),
	[
		'a heading demoted under a started title',
		['[a]: /u', "    'code", '# h', 'text', "end'", ...TAIL],
		2,
		'# ',
		BACKSPACE
	],
	[
		'a letter that makes a heading a line of text',
		['[a]: /u', "    'code", '# h', 'text', "end'", ...TAIL],
		2,
		'',
		typed('-')
	],
	[
		'the quote that ended a title, deleted',
		['[a]: /u', '    "code', '[b]: /v', 'end"', ...TAIL],
		0,
		'end"',
		BACKSPACE
	],
	[
		'Backspace at the start of the block that ends the title',
		['[a]: /u', '    "code', 'text', '', 'end"', ...TAIL],
		3,
		'',
		BACKSPACE
	],
	[
		'Delete at the end of the block above the one that ends it',
		['[a]: /u', '    "code', 'text', '', 'end"', ...TAIL],
		2,
		'text',
		DELETE
	]
];

beforeEach(() => installPlugins(ALPHABET_PLUGINS()));

describe('a key under a definition whose title has started', () => {
	for (const wrap of ['top', 'quote', 'item'] as const) {
		for (const eol of ['\n', '\r\n']) {
			const where = `${wrap}${eol === '\n' ? '' : ', CRLF'}`;
			it.each(ROWS)(`${where}: %s`, async (_, lines, block, after, edit) => {
				const source = wrapped(lines, wrap, eol);
				const path = [...LIST[wrap], block];
				const raw = leafAt(opened(source).children, path).raw;
				const offset = after === '' ? 0 : raw.indexOf(after) + after.length;

				expect(await judge(source, path, offset, edit)).toBeNull();
			});
		}
	}
});
