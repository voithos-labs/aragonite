// Miss-analysis (C-I1): table.test.ts pinned only the pipeless terminator, so no case asked
// what a pipe-carrying block start does. The absorption round-trips on load, which is why the
// property suites stayed green — the bytes are only rewritten by the next structural edit.
// Expected shapes verified against cmark-gfm via api.github.com/markdown.
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { insertEmptyColumn } from '../../../tree-operations/table-mutations';
import { rebuildTableRaw } from '../../../schema/container-rebuilders';

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n';

function topKinds(source: string): string[] {
	const doc = parse(source);
	expect(serialize(doc)).toBe(source);
	return doc.children.map((c) => String(c.kind));
}

describe('table continuation stops at a block start, pipe or no pipe', () => {
	const enders: [name: string, tail: string, kind: string][] = [
		['ATX heading', '# head | x\n', 'heading'],
		['blockquote', '> q | here\n', 'blockquote'],
		['list item', '- item | x\n', 'list'],
		['indented code', '    ind | x\n', 'indentedCode']
	];

	for (const [name, tail, kind] of enders) {
		it(`breaks the table at a ${name}`, () => {
			expect(topKinds(TABLE + tail)).toEqual(['table', kind]);
		});
	}

	// A definition is carved out of a paragraph at finalize, never opened as a block, so a
	// definition-shaped line with a pipe is an ordinary body row.
	it('keeps a link-reference-shaped row in the table', () => {
		const doc = parse(TABLE + '[a]: /u | x\n');
		expect(doc.children.map((c) => String(c.kind))).toEqual(['table']);
		expect(doc.children[0].children).toHaveLength(3);
	});
});

describe('table continuation guards the absorbed block from the next structural edit', () => {
	it('leaves a heading below the table untouched when a column is inserted', () => {
		const doc = parse(TABLE + '# head | x\n');
		insertEmptyColumn(doc.children[0], 0, 'right');
		rebuildTableRaw(doc.children[0]);
		expect(serialize(doc)).toContain('# head | x\n');
	});
});
