// Miss-analysis: every task fixture put plain prose after the marker, so nothing drew a line whose
// text after `[ ] ` would open a block, and the body parse read `# note` there as a heading.
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import type { CstNode } from '../../../core/nodes';

// GFM task lists: the marker is the start of the item's first paragraph, so the rest of that
// line is paragraph text whatever it looks like. Later lines parse as blocks, as in any item.

function taskItem(source: string): CstNode {
	const doc = parse(source);
	expect(serialize(doc)).toBe(source);
	const item = doc.children[0].children![0];
	expect(item.metadata).toMatchObject({ taskItem: true });
	return item;
}

const shape = (item: CstNode) => item.children!.map((child) => [child.kind, child.raw]);

describe('task marker: the rest of its line is paragraph text', () => {
	const cases: [source: string, text: string][] = [
		['- [ ] # adwada\n', '# adwada\n'],
		['- [x] ```js\n', '```js\n'],
		['- [ ] 1. not a list\n', '1. not a list\n'],
		['- [ ] > not a quote\n', '> not a quote\n'],
		['- [X] ---\n', '---\n'],
		['- [ ] # crlf\r\n', '# crlf\r\n']
	];

	it.each(cases)('%j holds one paragraph', (source, text) => {
		expect(shape(taskItem(source))).toEqual([['paragraph', text]]);
	});

	it('a lazy continuation line joins that paragraph', () => {
		expect(shape(taskItem('- [ ] # note\nmore\n'))).toEqual([['paragraph', '# note\nmore\n']]);
	});
});

describe('task marker: the lines after it parse as blocks', () => {
	it('a heading on the next line is a heading after an empty task paragraph', () => {
		expect(shape(taskItem('- [ ] \n  # h\n'))).toEqual([
			['paragraph', '\n'],
			['heading', '# h\n']
		]);
	});

	it('a heading under the task text interrupts its paragraph', () => {
		expect(shape(taskItem('- [ ] # note\n  ## h2\n'))).toEqual([
			['paragraph', '# note\n'],
			['heading', '## h2\n']
		]);
	});

	it('a blank line after the task paragraph separates rather than becoming a block', () => {
		const item = taskItem('- [ ] # note\n\n  > quote\n');
		expect(shape(item)).toEqual([
			['paragraph', '# note\n'],
			['blockquote', '> quote\n']
		]);
		expect(item.children![1].leadingTrivia).toBe('\n');
	});

	it('a plain item still opens a block after its marker', () => {
		const doc = parse('- # heading\n');
		expect(doc.children[0].children![0].children![0].kind).toBe('heading');
	});
});
