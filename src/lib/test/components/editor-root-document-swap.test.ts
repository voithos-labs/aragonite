// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createDocumentSwap, initDocument } from '#lib/components/editor-root-document-swap.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import type { LinkReferenceResolver } from '#lib/core/inline/link-reference-resolver.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createRegistryView } from '#lib/schema/registry-view.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

// Miss-analysis: the swap was tested one consequence at a time, so a dropped middle step passed.

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
	/** An editor holding `held\n` until the first swap adopts a document. */
	function harness() {
		const order: string[] = [];
		const step = (name: string) => () => void order.push(name);
		const selection = createSelectionState({ onChange: step('announce') });
		let adopted: Document | null = null;
		let links: { resolver: LinkReferenceResolver; signature: string } | null = null;
		const swaps: { generation: number; source: string }[] = [];
		const swap = createDocumentSwap({
			grammar: defaultGrammarView,
			currentSource: () => (adopted ? serialize(adopted) : 'held\n'),
			stamps: { retire: step('stamps') },
			drafts: { closeAll: (cause) => void order.push(`drafts:${cause}`) },
			flushDebouncedCheckpoint: step('flush'),
			noteTreeSwap: step('landings'),
			adoptDocument: (doc) => {
				adopted = doc;
				order.push('adopt');
			},
			bumpContentVersion: step('bump'),
			clearBlockRefs: step('refs'),
			layout: { forgetMeasuredHeights: step('heights') },
			undoManager: { clear: step('undo') },
			caretMemory: { forget: step('caret') },
			menus: { closeAll: (cause) => void order.push(`menus:${cause}`) },
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

	it('runs every reset in order, the outgoing document retired first, the announcement last', () => {
		const h = harness();
		h.swap.swapTo('# B\n');
		expect(h.order).toEqual([
			'stamps',
			'drafts:document-swap',
			'flush',
			'landings',
			'adopt',
			'bump',
			'refs',
			'heights',
			'undo',
			'caret',
			'menus:document-swap',
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

	it('drops a selected widget in the same announcement', () => {
		const h = harness();
		selectWidgetWhole(h.selection, testCaretWriter, {
			paragraphPath: [0],
			sourceStart: 0,
			preSelectOffset: 0
		});
		h.order.length = 0;
		h.swap.swapTo('# B\n');
		expect(h.selection.widget).toBeNull();
		expect(h.order.filter((name) => name === 'announce')).toHaveLength(1);
	});

	it('runs no step for the text the editor already holds', () => {
		const h = harness();
		h.swap.swapTo('held\n');
		h.swap.swapTo('a\n');
		h.swap.swapTo('a\n');
		expect(h.swap.generation()).toBe(1);
		expect(h.order.filter((name) => name === 'flush')).toHaveLength(1);
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
