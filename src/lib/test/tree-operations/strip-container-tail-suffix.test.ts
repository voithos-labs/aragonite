import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { documentLineEnding, trailingLineEnding } from '$lib/core/lines';
import { updateNodeContent } from '$lib/tree-operations';
import { deleteNode, settleSeparator } from '$lib/tree-operations/settle';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A blockquote keeps its body's one trailing blank line in `innerSuffix` only while its last
// block is non-blank, as the document keeps its own in `suffix`; once that block turns blank the
// reload reads the line as one more empty paragraph, so the fix-up makes it a block (GH #393).
// Miss-analysis: the shape property drew a quote ending on a bare `>` line under a blanked
// paragraph only eight shrink steps deep, and no unit case blanked the paragraph above that line.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

/** The chain from the document down to the container holding `path`'s block. */
function containersAlong(doc: Document, path: number[]): CstNode[] {
	const chain: CstNode[] = [];
	let holder: Document | CstNode = doc;
	for (const i of path.slice(0, -1)) {
		holder = holder.children![i];
		chain.push(holder);
	}
	return chain;
}

function rebuild(chain: CstNode[]): void {
	for (let i = chain.length - 1; i >= 0; i--) {
		getBlockKindDescriptor(chain[i].kind).rebuildRaw?.(chain[i]);
	}
}

/** What `commitInput` sends for an emptied block: the line ending alone. */
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
	rebuild(chain);
}

describe("blanking a blockquote's last block turns its trailing line into a block", () => {
	it('a quote ending on a bare `>` line reloads to the two blank blocks it shows', () => {
		const doc = parse('> b\n>\n');

		empty(doc, [0, 0]);

		const quote = doc.children[0];
		expect(serialize(doc)).toBe('>\n>\n');
		expect(quote.children!.map((c) => [c.leadingTrivia, c.raw])).toEqual([
			['', '\n'],
			['', '\n']
		]);
		expect(quote.innerSuffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
	});

	it.each([
		['the last of two paragraphs', '> a\n>\n> b\n>\n', [0, 1]],
		['a nested quote', '> > b\n> >\n', [0, 0, 0]],
		['a quote with a block after it', '> b\n>\n\nafter\n', [0, 0]],
		['a CRLF quote', '> b\r\n>\r\n', [0, 0]]
	])('%s reloads to its own shape', (_, source, path) => {
		const doc = parse(source);

		empty(doc, path);

		expect(describeConvergence(doc)).toBeNull();
	});

	// No trailing `>` line, or the blanked block is not the last: nothing moves out of the suffix.
	it.each([
		['> b\n', [0, 0]],
		['>\n> b\n', [0, 1]],
		['> b\n>\n> c\n', [0, 0]],
		['> b\n>\n> c\n', [0, 1]]
	])('%j stays converged', (source, path) => {
		const doc = parse(source);

		empty(doc, path);

		expect(describeConvergence(doc)).toBeNull();
	});

	// The commit's own fix-up over the owned container: a delete that leaves a blank last block.
	it('a delete that leaves a blank block last turns the line into a block too', () => {
		const doc = parse('> a\n>\n>\n> c\n>\n');
		const quote = doc.children[0];
		const before = [...quote.children!];

		const change = deleteNode(
			{
				children: quote.children!,
				ownerKind: quote.kind,
				owner: quote,
				lineEnding: documentLineEnding(doc)
			},
			2,
			defaultGrammarView
		);
		settleSeparator(quote, before, change, defaultGrammarView);
		rebuild([quote]);

		expect(describeConvergence(doc)).toBeNull();
	});

	// A GitHub alert has an opener line and no closer, so its body keeps the trailing line the
	// same way; only an all-blank body gives that line to the opener on reload instead.
	it.each([
		['the last of two paragraphs', '> [!NOTE]\n> a\n>\n> b\n>\n', [0, 1]],
		['its one paragraph', '> [!NOTE]\n> b\n>\n', [0, 0]],
		['a paragraph under a blank line', '> [!NOTE]\n>\n> b\n>\n', [0, 0]]
	])('an alert blanking %s reloads to its own shape', (_, source, path) => {
		const doc = parse(source);

		empty(doc, path);

		expect(describeConvergence(doc)).toBeNull();
	});
});
