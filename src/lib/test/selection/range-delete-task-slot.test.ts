// Miss-analysis: GH #639; the range-delete suites joined into top-level blocks and plain list
// items, and none compared the tree a join left in a task item's slot with its reload.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { CstNode, Document } from '../../core/nodes';
import { rangeDelete } from '../../selection/range-delete';
import { coverRange } from '../../selection/range-coverage';
import { cellPoint, type SelectionPoint } from '../../selection/primitives';
import { createSharingState } from '../../tree-operations/sharing';
import { fixtureReading } from '../harness/fixture-grammar';
import { registerChromePluginsForTests } from './chrome-plugins';

// Bytes a range delete leaves at a list item's first slot read as a reload reads them: after a
// task marker `# b` is paragraph text, and a first block that is no paragraph gives the marker up.

const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const OPEN = '<details open>\n<summary>Sum</summary>\n\nBody\n\n</details>\n';
const TABLE = '| a |\n| - |\n| 1 |\n';

/** Kinds and task flags all the way down: what the tree holds and what its reload must match. */
function shape(nodes: readonly CstNode[]): unknown[] {
	return nodes.map((node) => [
		node.kind,
		node.kind === 'listItem' ? (node.metadata as { taskItem: boolean }).taskItem : null,
		node.kind === 'tableRow' ? [] : shape(node.children ?? [])
	]);
}

function del(source: string, start: SelectionPoint, end: SelectionPoint): Document {
	const doc = parse(source);
	rangeDelete(doc, coverRange(doc, start, end), createSharingState(), fixtureReading());
	expect(shape(doc.children), serialize(doc)).toEqual(shape(parse(serialize(doc)).children));
	return doc;
}

const firstItem = (doc: Document) => doc.children[0].children![0];

beforeEach(registerChromePluginsForTests);

describe('a join into a task item’s first slot keeps the checkbox and the paragraph', () => {
	it.each([
		['from the next item', '- [ ] a\n- # b\n', point([0, 0, 0], 0), point([0, 1, 0], 0)],
		['from a heading below the list', '- [ ] a\n\n# b\n', point([0, 0, 0], 0), point([1], 0)],
		['from a fence below the list', '- [ ] a\n\n```\nb\n```\n', point([0, 0, 0], 0), point([1], 0)]
	])('the plain branch, %s', (_, source, start, end) => {
		const item = firstItem(del(source, start, end));
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.metadata).toMatchObject({ taskItem: true });
	});

	it.each([
		['the title-line branch', '- [ ] # bx\n\n' + OPEN, point([1, 0], 1)],
		['the table branch', '- [ ] # bx\n\n' + TABLE, cellPoint([1], 0)]
	])('%s, truncating the start to `# b`', (_, source, end) => {
		const item = firstItem(del(source, point([0, 0, 0], 3), end));
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.metadata).toMatchObject({ taskItem: true });
	});

	it('the table branch, truncating the end to `# b`', () => {
		const doc = del(TABLE + '\n- [ ] x# b\n', cellPoint([0], 1), point([1, 0, 0], 1));
		const item = doc.children[doc.children.length - 1].children![0];
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.metadata).toMatchObject({ taskItem: true });
	});
});

describe('a join that changes what stands at a list item’s first slot reconciles the marker', () => {
	it('a plain item whose paragraph now opens with `[ ] ` becomes a task', () => {
		const item = firstItem(del('- a\n\n[ ] b\n', point([0, 0, 0], 0), point([1], 0)));
		expect(item.metadata).toMatchObject({ taskItem: true });
	});

	// A delimiter row under the first line makes the slot a table, and a task marker stands only
	// before a paragraph, so the checkbox goes with it.
	it.each([
		['the plain branch', '- [ ] |b|\n  zz\n\nq|-|\n', point([0, 0, 0], 4), point([1], 1)],
		[
			'the title-line branch',
			'- [ ] |b|\n  |-|x\n\n' + OPEN,
			point([0, 0, 0], 7),
			point([1, 0], 1)
		],
		['the table branch', '- [ ] |b|\n  |-|x\n\n' + TABLE, point([0, 0, 0], 7), cellPoint([1], 0)]
	])('%s: a slot re-read as a table gives the checkbox up', (_, source, start, end) => {
		const doc = del(source, start, end);
		expect(firstItem(doc).children![0].kind).toBe('table');
		expect(firstItem(doc).metadata).toMatchObject({ taskItem: false });
		expect(serialize(doc)).toMatch(/^- \| ?b ?\|\n/);
	});
});
