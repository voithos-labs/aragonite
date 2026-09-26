// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createDocumentSwap, initDocument } from '$lib/components/editor-root-document-swap';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import type { LinkReferenceResolver } from '$lib/core/inline/link-reference-resolver';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createRegistryView } from '$lib/schema/registry-view';

// Miss-analysis: the swap was pinned through a mounted editor one consequence at a time
// (heights, undo, the selection announcement), so a step dropped from the middle of the
// sequence failed no unit test; and no step closed a menu, since no spec swapped under one.

describe('initDocument', () => {
	it('parses the empty source to one empty LF paragraph', () => {
		const { doc } = initDocument('', defaultGrammarView);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(serialize(doc)).toBe('\n');
	});

	it('resolves the link references the source defines', () => {
		const { resolver, signature } = initDocument('[a]: https://a.example\n', defaultGrammarView);
		expect(resolver('a')?.url).toBe('https://a.example');
		expect(signature).not.toBe(initDocument('plain\n', defaultGrammarView).signature);
	});

	it('reads the source in the editor grammar, so a switched-off syntax loads as prose', () => {
		const grammar = createRegistryView({ syntax: { indentedCode: false } }).grammar;
		expect(initDocument('\tnotes\n', grammar).doc.children[0].kind).toBe('paragraph');
	});
});

describe('the swap commit sequence', () => {
	function harness() {
		const order: string[] = [];
		const step = (name: string) => () => void order.push(name);
		const selection = createSelectionState({ onChange: step('announce') });
		let adopted: Document | null = null;
		let links: { resolver: LinkReferenceResolver; signature: string } | null = null;
		const swaps: { generation: number; source: string }[] = [];
		const swap = createDocumentSwap({
			grammar: defaultGrammarView,
			flushDebouncedCheckpoint: step('flush'),
			adoptDocument: (doc) => {
				adopted = doc;
				order.push('adopt');
			},
			bumpContentVersion: step('bump'),
			clearBlockRefs: step('refs'),
			heightOracle: { dropMeasured: step('heights') },
			undoManager: { clear: step('undo') },
			caretMemory: { forget: step('caret') },
			closeMenus: step('menus'),
			widgetSelection: { clear: step('widget') },
			selection,
			adoptLinkReferences: (resolver, signature) => {
				links = { resolver, signature };
				order.push('links');
			},
			events: {
				emit: (event, payload) => {
					order.push(event);
					// What a subscriber reads inside its handler: the document already adopted.
					if (event === 'sourceSwap')
						swaps.push({ ...(payload as { generation: number }), source: serialize(adopted!) });
				}
			}
		});
		return { swap, selection, order, swaps, adopted: () => adopted, links: () => links };
	}

	it('runs every reset in order, the checkpoint flush first and the announcement last', () => {
		const h = harness();
		h.swap.swapTo('# B\n');
		expect(h.order).toEqual([
			'flush',
			'adopt',
			'bump',
			'refs',
			'heights',
			'undo',
			'caret',
			'menus',
			'widget',
			'announce',
			'links',
			'sourceSwap'
		]);
		expect(serialize(h.adopted()!)).toBe('# B\n');
	});

	it('announces once per swap even over a live range, and hands over the new resolver', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 1 });
		h.order.length = 0;
		h.swap.swapTo('[x]: https://x.example\n');
		expect(h.order.filter((name) => name === 'announce')).toHaveLength(1);
		expect(h.selection.isCrossBlock).toBe(false);
		expect(h.links()!.resolver('x')?.url).toBe('https://x.example');
	});

	it('counts whole-document replacements and announces each with the new document in place', () => {
		const h = harness();
		expect(h.swap.generation()).toBe(0);
		h.swap.swapTo('a\n');
		h.swap.swapTo('b\n');
		expect(h.swap.generation()).toBe(2);
		expect(h.swaps).toEqual([
			{ generation: 1, source: 'a\n' },
			{ generation: 2, source: 'b\n' }
		]);
	});
});
