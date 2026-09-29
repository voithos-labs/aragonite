// @vitest-environment jsdom
// Miss-analysis: nothing counted what a keystroke reads of the tree, so a store resolved up front
// would walk the document on every key in every block and no suite would notice.
import { describe, expect, it } from 'vitest';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode, Document } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { applyLiveRangeEdit } from '$lib/components/blocks/text/live-selection-edit';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { mountBlock } from '../../harness/mount-block';
import { settleEditor } from '../../harness/settle';
import { noIslands } from '../table/mount-cell';
import { fixtureReading } from '../../harness/fixture-grammar';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface
} from './edge-policy-fixture';

installEdgeDispatchCleanup();

const SOURCE = '- Some **bold** text\n';
const LEAF = [0, 0, 0];
const LIVE = fixtureReading({}, 'live');

/** `children` behind a proxy that counts every indexed read, one trap each, the way the editor's
 *  `$state` array pays for them. */
function countingReads(children: CstNode[]) {
	let reads = 0;
	const proxy = new Proxy(children, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
			return Reflect.get(target, prop, receiver);
		}
	});
	return { proxy, reads: () => reads, reset: () => void (reads = 0) };
}

/** The list item's paragraph, in a document whose top-level list counts its reads. */
function countedLeaf() {
	const doc: Document = parse(SOURCE);
	const node = nodeAt(doc, LEAF) as CstNode;
	const counter = countingReads(doc.children);
	doc.children = counter.proxy;
	const storedAs = () => storedAsAt(doc, LEAF, LIVE);
	return { node, storedAs, reads: counter.reads };
}

function dispatchOver(leaf: ReturnType<typeof countedLeaf>) {
	const el = mountSurface(trimTrailingLineEnding(leaf.node.raw), 'live');
	return makeEdgeDispatch(leaf.node, el, { storedAs: leaf.storedAs });
}

describe('a keystroke with no hidden run beside it reads nothing of where the block is stored', () => {
	it.each([
		['Backspace inside a word', 'Backspace', 16],
		['Delete inside a word', 'Delete', 15],
		['a letter typed inside a word', 'X', 16]
	])('%s', (_name, name, caret) => {
		const leaf = countedLeaf();
		expect(dispatchOver(leaf).handleKeydown(key(name), at(caret))).toBe(false);
		expect(leaf.reads()).toBe(0);
	});

	// The block hands its store to the range edit on every beforeinput, so making one reads nothing.
	it('a typed byte at a collapsed caret, through the beforeinput range edit', () => {
		const leaf = countedLeaf();
		const e = new InputEvent('beforeinput', { inputType: 'insertText', data: 'X' });
		const cursor = { rawRangeOf: () => null, getRawSelection: () => null };
		const handled = applyLiveRangeEdit(
			e,
			leaf.node,
			cursor,
			'\n',
			leaf.storedAs(),
			() => false,
			() => {}
		);
		expect(handled).toBe(false);
		expect(leaf.reads()).toBe(0);
	});

	// The positive half: a key at a hidden run does read the store, so a zero above is no accident.
	it('Backspace at a hidden run reads it', () => {
		const leaf = countedLeaf();
		expect(dispatchOver(leaf).handleKeydown(key('Backspace'), at(13))).toBe(true);
		expect(leaf.reads()).toBeGreaterThan(0);
	});
});

// ── Through the mounted block ────────────────────────────────────────────────

/** The block mounted over a document whose list counts reads of its items: the store's walk to
 *  the list item goes through them, and nothing else a keystroke does. */
function mountCounted() {
	const doc: Document = parse(SOURCE);
	const list = doc.children[0];
	const counter = countingReads(list.children!);
	list.children = counter.proxy;
	const { target } = mountBlock(TextEditableBlock, {
		doc,
		path: LEAF,
		overrides: {
			policies: { presentationMode: () => 'live' },
			services: { decorations: noIslands }
		}
	});
	const el = target.querySelector('.text-editable-block') as HTMLElement;
	return { el, ...counter };
}

describe('the mounted block asks its store nothing for a keystroke away from a hidden run', () => {
	it.each([
		['a typed letter', 'insertText', 'X', 16],
		['Backspace', 'deleteContentBackward', undefined, 16]
	])('%s inside a word', async (_name, inputType, data, caret) => {
		const block = mountCounted();
		block.el.focus();
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(
			createRangeAtDomTextOffsets(block.el, asDomTextOffset(caret), asDomTextOffset(caret))!
		);
		await settleEditor();
		block.reset();
		block.el.dispatchEvent(
			new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
		);
		await settleEditor();
		expect(block.reads()).toBe(0);
	});
});

// Chromium hands a range edit its target range even for one character, so these take the range path.
describe('the mounted block asks its store nothing for a range edit away from a hidden run', () => {
	it.each([
		['Backspace over one character', 'deleteContentBackward', undefined, 15, 16],
		['a letter typed over a word', 'insertText', 'X', 14, 18]
	])('%s', async (_name, inputType, data, start, end) => {
		const block = mountCounted();
		block.el.focus();
		const target = createRangeAtDomTextOffsets(
			block.el,
			asDomTextOffset(start),
			asDomTextOffset(end)
		)!;
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(target);
		await settleEditor();
		block.reset();
		const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
		Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
		block.el.dispatchEvent(e);
		await settleEditor();
		expect(block.reads()).toBe(0);
	});
});
