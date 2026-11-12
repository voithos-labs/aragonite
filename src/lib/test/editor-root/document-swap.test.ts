// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	createDocumentSwap,
	initDocument,
	type DocumentSwap
} from '#lib/components/editor-root/document-swap.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import type { LinkReferenceResolver } from '#lib/core/inline/scan/definitions.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
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
		const grammar = createEditorGrammar({ syntax: { indentedCode: false } });
		expect(initDocument('\tnotes\n', grammar).doc.children[0].kind).toBe('paragraph');
	});
});

describe('the swap commit sequence', () => {
	/** An editor holding `held\n` until the first swap adopts a document; `hoverEnds` is a mark's
	 *  handler, run as the outgoing document's hover ends. */
	function harness(grammar: GrammarView = defaultGrammarView, hoverEnds = () => {}) {
		const order: string[] = [];
		const step = (name: string) => () => void order.push(name);
		const selection = createSelectionState({ onChange: step('announce') });
		let adopted: Document | null = null;
		let links: { resolver: LinkReferenceResolver; signature: string } | null = null;
		const swaps: { generation: number; source: string }[] = [];
		const swap = createDocumentSwap({
			grammar,
			currentSource: () => (adopted ? serialize(adopted) : 'held\n'),
			stamps: { retire: step('stamps') },
			doc: () => adopted ?? initDocument('held\n', defaultGrammarView).doc,
			drafts: {
				closeAll: (cause) => void order.push(`drafts:${cause}`),
				watching: () => false,
				record: () => {}
			},
			markHover: {
				end() {
					order.push('hover');
					hoverEnds();
				}
			},
			flushDebouncedCheckpoint: step('flush'),
			noteTreeSwap: step('landings'),
			adoptDocument: (doc) => {
				adopted = doc;
				order.push('adopt');
			},
			starts: createKeptStarts(
				() => adopted ?? initDocument('held\n', defaultGrammarView).doc,
				step('bump')
			),
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
		/** Writes the document as a byte writer does, outside any swap. */
		const write = (source: string) => void (adopted = initDocument(source, grammar).doc);
		return { swap, selection, order, swaps, write, adopted: () => adopted, links: () => links };
	}

	it('runs every reset in order, the outgoing document retired first, the announcement last', () => {
		const h = harness();
		h.swap.swapTo('# B\n');
		expect(h.order).toEqual([
			'stamps',
			'drafts:document-swap',
			'hover',
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

	// Miss-analysis: every row read bytes that parse, so none saw the outgoing document retired
	// and its drafts closed ahead of a read that then threw.
	it.each([
		{ name: 'a swap', write: (swap: DocumentSwap) => swap.swapTo('# B\n') },
		{ name: 'a re-read', write: (swap: DocumentSwap) => swap.reparse() }
	])('$name whose read throws runs no step', ({ write }) => {
		const throwing: GrammarView = Object.create(defaultGrammarView, {
			orderedOpeners: {
				value: () => {
					throw new Error('an opener blew up');
				}
			}
		});
		const h = harness(throwing);
		expect(() => write(h.swap)).toThrow('an opener blew up');
		expect(h.order).toEqual([]);
		expect(h.adopted()).toBeNull();
	});

	// Miss-analysis: no row's outgoing handler wrote, so a re-read that adopted bytes read before
	// the handler ran lost nothing a row could see.
	it('a re-read adopts what a handler of the outgoing document wrote as it ended', () => {
		const h = harness(defaultGrammarView, () => h.write('held\n\nwritten as the hover ended\n'));
		h.swap.reparse();
		expect(serialize(h.adopted()!)).toBe('held\n\nwritten as the hover ended\n');
	});

	it('announces once per swap even over a live range, and hands over the new resolver', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 1 });
		h.order.length = 0;
		h.swap.swapTo('[x]: https://x.example\n');
		expect(h.order.filter((name) => name === 'announce')).toHaveLength(1);
		expect(h.selection.ownsRange).toBe(false);
		expect(h.links()!.resolver('x')?.url).toBe('https://x.example');
	});

	it('drops a selected widget in the same announcement', () => {
		const h = harness();
		selectWidgetWhole(
			h.selection,
			testCaretWriter,
			{
				paragraphPath: [0],
				sourceStart: 0,
				preSelectOffset: 0
			},
			() => null
		);
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
