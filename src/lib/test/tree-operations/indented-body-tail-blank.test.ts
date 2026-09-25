import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { documentLineEnding, trailingLineEnding } from '$lib/core/lines';
import { updateNodeContent } from '$lib/tree-operations';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A list item's or footnote's body ends where its indentation ends, so an emptied last block's
// own line is written with the body's indent and reloads as the empty paragraph it is (GH #406).
// Miss-analysis: the shape property skipped every list-item body for a different shape, and no
// unit case blanked the last block of an indent-delimited body.

beforeAll(() => {
	installPlugins([footnotesPlugin()]);
});

function containersAlong(doc: Document, path: number[]): CstNode[] {
	const chain: CstNode[] = [];
	let holder: Document | CstNode = doc;
	for (const i of path.slice(0, -1)) {
		holder = holder.children![i];
		chain.push(holder);
	}
	return chain;
}

/** What `commitInput` sends for an emptied block, the line ending alone, then the rebuilds. */
function empty(doc: Document, path: number[]): void {
	const chain = containersAlong(doc, path);
	const owner = chain[chain.length - 1];
	const index = path[path.length - 1];
	const text = trailingLineEnding(owner.children![index].raw, '\n');
	updateNodeContent(
		{
			children: owner.children!,
			ownerKind: owner.kind,
			owner,
			lineEnding: documentLineEnding(doc)
		},
		index,
		text,
		defaultGrammarView
	);
	for (let i = chain.length - 1; i >= 0; i--) {
		getBlockKindDescriptor(chain[i].kind).rebuildRaw?.(chain[i]);
	}
}

describe('blanking the last block of an indent-delimited body', () => {
	it.each([
		['a list item', '- a\n\n  b\n\n- c\n', [0, 0, 1], '- a\n\n  \n\n- c\n'],
		['a footnote', '[^1]: a\n\n    b\n\n', [0, 1], '[^1]: a\n\n    \n\n'],
		[
			'a CRLF list item',
			'- a\r\n\r\n  b\r\n\r\n- c\r\n',
			[0, 0, 1],
			'- a\r\n\r\n  \r\n\r\n- c\r\n'
		],
		['a CRLF footnote', '[^1]: a\r\n\r\n    b\r\n', [0, 1], '[^1]: a\r\n\r\n    \r\n']
	])('%s writes the body indent and reloads as the tree it holds', (_, source, path, after) => {
		const doc = parse(source);

		empty(doc, path);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});

	it.each([
		['a nested item', '- a\n  - b\n\n    c\n', [0, 0, 1, 0, 1]],
		['an item whose body ends on an indented blank line', '- a\n\n  b\n  \n- c\n', [0, 0, 1]],
		['the only paragraph of an item with a trailing indented line', '- a\n  \n- c\n', [0, 0, 0]]
	])('%s reloads to its own shape', (_, source, path) => {
		const doc = parse(source);

		empty(doc, path);

		expect(describeConvergence(doc)).toBeNull();
	});

	it.each([
		['a list item', '- a\n\n\nafter\n', '  \n'],
		['a footnote', '[^1]: a\n\n\nafter\n', '    \n']
	])('indenting the blank line under %s takes it into the body', (_, source, typed) => {
		const doc = parse(source);

		settled(doc, () => updateNodeContent(doc, 1, typed, defaultGrammarView).change);

		expect(doc.children).toHaveLength(2);
		expect(describeConvergence(doc)).toBeNull();
	});

	// A blank line with content after it inside the body stays bare.
	it.each([
		['- a\n\n  b\n\n  c\n', [0, 0, 1], '- a\n\n\n  c\n'],
		['[^1]: a\n\n    b\n\n    c\n', [0, 1], '[^1]: a\n\n\n    c\n']
	])('blanking a middle block of %j keeps its lines bare', (source, path, after) => {
		const doc = parse(source);

		empty(doc, path);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});
