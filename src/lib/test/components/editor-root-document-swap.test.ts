// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { createDocumentSwap, initDocument } from '$lib/components/editor-root-document-swap';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import type { LinkReferenceResolver } from '$lib/core/inline/link-reference-resolver';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createRegistryView } from '$lib/schema/registry-view';
import { createEditorEvents, type EditorEvents } from '$lib/editor-events';
import { takeDevWarns } from '../support/warn-gate';

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
	function harness(duringFlush?: (events: EditorEvents) => void) {
		const order: string[] = [];
		const channel = createEditorEvents();
		const step = (name: string) => () => void order.push(name);
		const selection = createSelectionState({ onChange: step('announce') });
		let adopted: Document | null = null;
		let links: { resolver: LinkReferenceResolver; signature: string } | null = null;
		const swaps: { generation: number; source: string }[] = [];
		const swap = createDocumentSwap({
			grammar: defaultGrammarView,
			currentSource: () => (adopted ? serialize(adopted) : 'held\n'),
			drafts: { closeAll: (cause) => void order.push(`drafts:${cause}`) },
			flushDebouncedCheckpoint: () => {
				order.push('flush');
				duringFlush?.(channel);
			},
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
					channel.emit(event, payload);
				},
				on: channel.on
			}
		});
		return {
			swap,
			selection,
			order,
			swaps,
			events: channel,
			adopted: () => adopted,
			links: () => links
		};
	}

	it('runs every reset in order, the drafts dropped first and the announcement last', () => {
		const h = harness();
		h.swap.swapTo('# B\n');
		expect(h.order).toEqual([
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

	it('G1.53: says so in a dev build when an edit fires during the swap', async () => {
		const h = harness((events) => events.emit('edit', { op: 'input', path: [0], timestamp: 0 }));
		h.swap.swapTo('b\n');
		await tick();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:swap-fires-no-edit']);
	});

	// Where a torn-down block's blur commit lands: in the render that follows the swap.
	it('G1.53: and when one fires in the render after it', async () => {
		const h = harness();
		h.swap.swapTo('b\n');
		h.events.emit('edit', { op: 'input', path: [0], timestamp: 0 });
		await tick();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:swap-fires-no-edit']);
	});

	it('G1.53: stays quiet for a swap that fires no edit', async () => {
		harness().swap.swapTo('b\n');
		await tick();
		expect(takeDevWarns()).toEqual([]);
	});
});
