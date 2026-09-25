import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A rebuild writes a body's blank lines the way the parser reads them: the separator after a
// block bare, an empty paragraph's own line indented, so one keystroke moves no other byte.
// Miss-analysis: the tail-blank cases only blanked a block and checked the reload, and no case
// typed into a loaded body whose separator was bare and asked for the untouched bytes.

beforeAll(() => {
	installPlugins([footnotesPlugin()]);
});

/** Types `x` at the end of the block at `path`, then rebuilds every container above it whole. */
function typeX(doc: Document, path: number[]): void {
	const chain: CstNode[] = [];
	let holder: Document | CstNode = doc;
	for (const i of path.slice(0, -1)) {
		holder = holder.children![i];
		chain.push(holder);
	}
	const owner = chain[chain.length - 1];
	const index = path[path.length - 1];
	const text = owner.children![index].raw.replace(/(\r?\n)?$/, (ending) => 'x' + ending);
	updateNodeContent(
		{ children: owner.children!, ownerKind: owner.kind, owner },
		index,
		text,
		defaultGrammarView
	);
	for (let i = chain.length - 1; i >= 0; i--) {
		getBlockKindDescriptor(chain[i].kind).rebuildRaw?.(chain[i]);
	}
}

describe('typing into a body that ends in an empty paragraph after a bare separator', () => {
	it.each([
		['a list item', '- a\n\n  \n\n- c\n', [0, 0, 0], '- ax\n\n  \n\n- c\n'],
		[
			'a CRLF list item',
			'- a\r\n\r\n  \r\n\r\n- c\r\n',
			[0, 0, 0],
			'- ax\r\n\r\n  \r\n\r\n- c\r\n'
		],
		['a footnote', '[^1]: a\n\n    \n\nnext\n', [0, 0], '[^1]: ax\n\n    \n\nnext\n'],
		[
			'a nested item',
			'- a\n  - b\n\n    \n\n- c\n',
			[0, 0, 1, 0, 0],
			'- a\n  - bx\n\n    \n\n- c\n'
		]
	])('%s keeps every byte but the typed one', (_, source, path, after) => {
		const doc = parse(source);

		typeX(doc, path);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});

// The tree does not record whether a separator line was indented, so an indented one is
// written bare; the reload reads the same blocks.
describe('typing into a body whose separator line was indented', () => {
	it.each([
		['a list item', '- a\n  \n  \n- c\n', [0, 0, 0], '- ax\n\n  \n- c\n'],
		['a footnote', '[^1]: a\n    \n    \nnext\n', [0, 0], '[^1]: ax\n\n    \nnext\n'],
		[
			'a nested item',
			'- a\n  - b\n    \n    \n- c\n',
			[0, 0, 1, 0, 0],
			'- a\n  - bx\n\n    \n- c\n'
		]
	])('%s writes the separator bare and reloads as the same blocks', (_, source, path, after) => {
		const doc = parse(source);

		typeX(doc, path);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('typing into a body whose trailing indented line is its separator', () => {
	it.each([
		['one indented line', '- a\n  \n- c\n', '- ax\n  \n- c\n'],
		['a line deeper than the content', '- a\n      \n- c\n', '- ax\n      \n- c\n']
	])('%s keeps the indent', (_, source, after) => {
		const doc = parse(source);

		typeX(doc, [0, 0, 0]);

		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});
