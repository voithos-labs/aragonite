// @vitest-environment jsdom
// The answers of `editor.view` that aren't geometry: an overlay comes off once a write replaces its
// block, when its plugin is turned off and when the editor unmounts; nothing watches until one is
// attached; a point outside the editor names no byte. The geometry is `e2e/tests/plugins/view.spec.ts`.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import { createEditorView } from '#lib/editor-view.js';
import { createDocumentRead } from '#lib/editor-actions/commit/document-read.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	vi.restoreAllMocks();
	await destroyMountedEditors();
});

const DOC = 'intro\n\npara one\n\npara two\n';
const LIST = '- ant\n- bee\n';

async function mounted(source = DOC) {
	let editor: Editor | undefined;
	const viewer = definePluginUnit({
		name: 'unit-viewer',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [viewer] });
	await m.settle();
	return { editor: editor!, m };
}

const pinned = () => document.createElement('div');

describe('an overlay', () => {
	it('stays through a key in another block, and comes off at the first key inside its own', async () => {
		const { editor, m } = await mounted();
		const el = pinned();
		const gone: string[] = [];
		const block = editor.doc.blocks[1];
		editor.view.overlay(el, block);
		const byte = pinned();
		editor.view.overlay(byte, editor.doc.blocks[2].from + 2);
		expect([el.isConnected, byte.isConnected, el.style.position]).toEqual([true, true, 'absolute']);
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect([el.isConnected, byte.isConnected]).toEqual([true, true]);
		typeInto(surfaceAt(m, [1]), 'para oneX');
		await m.settle();
		gone.push(el.isConnected ? 'kept' : 'off', byte.isConnected ? 'kept' : 'off');
		typeInto(surfaceAt(m, [2]), 'para twoX');
		await m.settle();
		gone.push(byte.isConnected ? 'kept' : 'off');
		expect(gone).toEqual(['off', 'kept', 'off']);
		expect(await editor.view.reveal(block)).toBe(false);
	});

	// Miss-analysis: `gone` was the editor's own argument, so no row heard it from a plugin.
	it('tells `gone` when it comes off by itself or by its call, and once each', async () => {
		const { editor, m } = await mounted();
		const heard: string[] = [];
		editor.view.overlay(pinned(), editor.doc.blocks[1], () => heard.push('typed in'));
		const off = editor.view.overlay(pinned(), editor.doc.blocks[2], () => heard.push('called'));
		typeInto(surfaceAt(m, [1]), 'para oneX');
		await m.settle();
		off();
		off();
		expect(heard).toEqual(['typed in', 'called']);
	});

	// A held block reads -1 while its node stands once a sibling is put in above it in its list
	// (it fails closed); the overlay comes off there too, and the block read again pins again.
	it('comes off once a sibling is put in above its block, and pins again on the block read anew', async () => {
		const { editor, m } = await mounted(LIST);
		const el = pinned();
		const bee = editor.blockAt(LIST.indexOf('bee'))!;
		editor.view.overlay(el, bee);
		await pressKeyAt(m, [0, 0, 0], 'ant'.length, { key: 'Enter' });
		await m.settle();
		expect([el.isConnected, await editor.view.reveal(bee)]).toEqual([false, false]);
		editor.view.overlay(el, editor.blockAt(m.source().indexOf('bee'))!);
		expect(el.isConnected).toBe(true);
	});

	it('comes off at its call, when its plugin is turned off, and when the editor unmounts', async () => {
		const { editor, m } = await mounted();
		const [called, plugin, handle] = [pinned(), pinned(), pinned()];
		editor.view.overlay(called, editor.doc.blocks[0])();
		editor.view.overlay(plugin, editor.doc.blocks[0]);
		expect([called.isConnected, plugin.isConnected]).toEqual([false, true]);
		m.instance.use([]);
		await m.settle();
		m.instance.view.overlay(handle, m.instance.doc.blocks[1]);
		expect([plugin.isConnected, handle.isConnected]).toEqual([false, true]);
		// The unmount stops the watch the overlay started, with nothing left listening.
		const stopped = vi.spyOn(MutationObserver.prototype, 'disconnect');
		await m.destroy();
		expect([handle.isConnected, stopped.mock.calls.length]).toEqual([false, 1]);
	});

	it('sits in the layer the editor reads as the host’s', async () => {
		const { editor, m } = await mounted();
		const el = pinned();
		editor.view.overlay(el, editor.doc.blocks[0]);
		expect(el.parentElement?.hasAttribute('data-host-content')).toBe(true);
		expect(m.target.querySelector('.editor')!.contains(el)).toBe(true);
	});

	// Miss-analysis: every row pinned one overlay, and none counted how often a key placed it:
	// each overlay heard the key and the render for itself, three passes a key apiece.
	it('places every overlay in one pass a key, however many are pinned', async () => {
		const { editor, m } = await mounted();
		const pins = [1, 2].map((i) => {
			const el = pinned();
			editor.view.overlay(el, editor.doc.blocks[i]);
			return el;
		});
		await m.settle();
		const layer = pins[0].parentElement!;
		const origin = vi.spyOn(layer, 'getBoundingClientRect');
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect(origin.mock.calls.length).toBe(1);
		expect(pins.map((el) => el.isConnected)).toEqual([true, true]);
	});

	it('watches nothing until one is attached', async () => {
		const observed = vi.spyOn(MutationObserver.prototype, 'observe');
		const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
		const { editor, m } = await mounted();
		const root = m.target.querySelector('.editor');
		const onRoot = () => observed.mock.calls.filter(([target]) => target === root);
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect(onRoot()).toEqual([]);
		const off = editor.view.overlay(pinned(), editor.doc.blocks[0]);
		expect(onRoot()).toHaveLength(1);
		const before = disconnected.mock.calls.length;
		off();
		expect(disconnected.mock.calls.length).toBe(before + 1);
	});
});

/** What an overlay at each byte of `source` measures: the offset of the character its rect is read
 *  over, or `block` where it takes its block's box. */
function overlaysAt(source: string, bytes: readonly number[]): (number | 'block')[] {
	const { doc, resolver, signature } = initDocument(source, defaultGrammarView);
	const of = measured(doc);
	const read = createDocumentRead({
		getDoc: () => doc,
		measured: () => of,
		typeOf: (kind) => ({ name: kind, label: kind }),
		reading: { grammar: defaultGrammarView, resolver, resolverSignature: signature },
		version: () => 0,
		source: () => source
	});
	const seen: (number | 'block')[] = [];
	const root = document.body.appendChild(document.createElement('div'));
	const layer = root.appendChild(document.createElement('div'));
	const { view, dispose } = createEditorView({
		rects: {
			rangeRects: (_path, start) => (seen.push(start), [new DOMRect()]),
			blockRect: () => (seen.push('block'), new DOMRect()),
			caretRect: () => null,
			scrollTo: async () => false
		},
		read,
		root: () => root,
		layer: () => layer,
		caretTargetAt: () => null,
		resized: () => () => {},
		events: { on: () => () => {} }
	});
	for (const at of bytes) view.overlay(pinned(), at);
	dispose();
	root.remove();
	return seen;
}

describe('an overlay at a byte', () => {
	// Miss-analysis: every overlay row pinned a block or a byte mid-line, so one at a nested CRLF
	// line's end, whose `\n` the byte map put on the `\r`'s byte, measured the wrong character.
	it.each([
		['LF', '\n'],
		['CRLF', '\r\n']
	])(
		"measures the character at its byte, a quote line's ending included, under %s",
		(_ending, eol) => {
			const source = 'intro\n\n> foo bar\n> baz qux\n'.replaceAll('\n', eol);
			const ending = source.indexOf(`bar${eol}`) + 3;
			const bytes = [ending, ending + eol.length - 1, source.length];
			expect(overlaysAt(source, bytes)).toEqual([7, 7 + eol.length - 1, 'block']);
		}
	);
});

describe('posAt', () => {
	it('names no byte for a point outside the editor', async () => {
		const { editor } = await mounted();
		expect(editor.view.posAt({ x: -50, y: -50 })).toBeNull();
	});
});
