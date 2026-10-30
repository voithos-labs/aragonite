// G4.159: a container whose last text is deleted at the end of the document keeps bytes that
// reload, in the editor, as the empty container it still shows, for every kind and both rebuilds.
// Miss-analysis: the read-back check skipped a container with no bytes, the one shape that loses it.
import { describe, it, expect } from 'vitest';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { rebuildAncestryRaw } from '#lib/schema/container-raw.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { makeContainerHarness } from '../harness/editor-actions';

interface EmptiedCase {
	kind: string;
	source: string;
	/** The container holding the leaf whose text is deleted, and the leaf's index in it. */
	container: number[];
	leaf: number;
	emptied: string;
}

const CASES: EmptiedCase[] = [
	{ kind: 'bullet item', source: '- **a**', container: [0, 0], leaf: 0, emptied: '- ' },
	{ kind: 'ordered item', source: '1. a', container: [0, 0], leaf: 0, emptied: '1. ' },
	{ kind: 'task item', source: '- [ ] a', container: [0, 0], leaf: 0, emptied: '- [ ] ' },
	{ kind: 'second item', source: '- a\n- b', container: [0, 1], leaf: 0, emptied: '- a\n- ' },
	{ kind: 'quote', source: '> a', container: [0], leaf: 0, emptied: '>' },
	{ kind: 'item in a quote', source: '> - a', container: [0, 0, 0], leaf: 0, emptied: '> - ' },
	{ kind: 'quote in an item', source: '- > a', container: [0, 0, 0], leaf: 0, emptied: '- >' },
	{ kind: 'footnote definition', source: '[^1]: a', container: [0], leaf: 0, emptied: '[^1]: ' },
	{ kind: 'alert', source: '> [!NOTE]\n> a', container: [0], leaf: 0, emptied: '> [!NOTE]' },
	{
		kind: 'admonition',
		source: ':::note\na\n:::',
		container: [0],
		leaf: 1,
		emptied: ':::note\n\n:::'
	}
];

function installCasePlugins(): void {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
}

/** The tree the editor would hold after saving `doc` and opening the file again. */
function reloadDivergence(doc: Document): string | null {
	return describeShapeDivergence(doc, initDocument(serialize(doc), defaultGrammarView).doc);
}

function leafAt(doc: Document, container: number[], leaf: number): CstNode {
	let node = doc.children[container[0]];
	for (const i of container.slice(1)) node = node.children![i];
	return node.children![leaf];
}

describe('G4.159 an emptied container keeps bytes that reload as it', () => {
	it.each(CASES)('$kind, through the text write', async ({ source, container, leaf, emptied }) => {
		installCasePlugins();
		const h = makeContainerHarness(source, container);
		const ending = leafAt(h.deps.doc, container, leaf).raw.match(/\r?\n$/)?.[0] ?? '';

		await h.bundle.blockEdit.updateBlockContent(leaf, ending, 'authored', 'join-typing', 0);

		expect(serialize(h.deps.doc)).toBe(emptied);
		expect(reloadDivergence(h.deps.doc)).toBeNull();
	});

	it.each(CASES)('$kind, through the ancestry rebuild', ({ source, container, leaf, emptied }) => {
		installCasePlugins();
		const h = makeContainerHarness(source, container);
		const target = leafAt(h.deps.doc, container, leaf);
		target.raw = target.raw.match(/\r?\n$/)?.[0] ?? '';

		rebuildAncestryRaw(
			h.deps.doc.children[container[0]],
			[...container.slice(1), leaf],
			defaultGrammarView
		);

		expect(serialize(h.deps.doc)).toBe(emptied);
		expect(reloadDivergence(h.deps.doc)).toBeNull();
	});
});
