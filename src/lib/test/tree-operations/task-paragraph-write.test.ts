// Miss-analysis: the task-marker tests typed prose into a to-do and the heading tests typed outside
// a list, so no write read a task paragraph's new text the way the parser reads the item's bytes.
import { describe, it, expect } from 'vitest';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// A write into a task item's first paragraph reads its text the way the parser reads the item:
// the line after the marker is paragraph text, so typing `# ` there keeps the paragraph and box.

function writeFirstTaskChild(doc: Document, text: string): CstNode {
	const list = doc.children[0];
	const item = list.children![0];
	updateNodeContent({ children: item.children!, ownerKind: item.kind, owner: item }, 0, text);
	getBlockKindDescriptor('listItem').rebuildRaw?.(item);
	getBlockKindDescriptor('list').rebuildRaw?.(list);
	return item;
}

describe('a write into a task item paragraph', () => {
	it.each([
		['- [ ] foo\n', '# foo\n', '- [ ] # foo\n'],
		['- [x] foo\n', '```js foo\n', '- [x] ```js foo\n'],
		['- [ ] foo\r\n', '> foo\r\n', '- [ ] > foo\r\n']
	])('%j written as %j keeps the task paragraph', (source, text, expected) => {
		const doc = parse(source);
		const item = writeFirstTaskChild(doc, text);
		expect(serialize(doc)).toBe(expected);
		expect(item.children!.map((c) => c.kind)).toEqual(['paragraph']);
		expect(item.metadata).toMatchObject({ taskItem: true });
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a heading on a later line of the written text still opens', () => {
		const doc = parse('- [ ] foo\n');
		const item = writeFirstTaskChild(doc, '# foo\n# bar\n');
		expect(item.children!.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a plain item still turns `# ` into a heading', () => {
		const doc = parse('- foo\n');
		const item = writeFirstTaskChild(doc, '# foo\n');
		expect(item.children!.map((c) => c.kind)).toEqual(['heading']);
		expect(describeConvergence(doc)).toBeNull();
	});
});
