// @vitest-environment jsdom
//
// Miss-analysis: the reveal's own undo matched Ctrl+Z by hand, so no test could ask the keymap
// what the chord meant, and every case ended before the document moved under an open reveal.
// Its granularity went the same way: every case made ONE edit, so nothing could see that a
// second keystroke pushed a second entry where the document would have batched both.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import {
	normalizeKeybindingOverrides,
	type KeybindingOverride
} from '$lib/schema/keybinding-overrides';
import { createRangeFromOffsets, getCursorOffset } from '$lib/cursor/content-offsets';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import { editorMountContext } from '../harness/mount-context';
import { installLayoutStubs } from './editor-mount';

const KIND = 'painted-undo-leaf';
const SOURCE = '@@ one';

/** Drains the microtask queue the async keydown handler and the reveal both run on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

function paint(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const span = document.createElement('span');
	span.textContent = text;
	frag.appendChild(span);
	return frag;
}

function mountLeaf(keybindings: KeybindingOverride[] = []) {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});
	// Reactive on purpose: the source's sync attachment re-runs on `raw`, which is how an
	// external rewrite (an undo landing new bytes at this index) reaches an open reveal.
	const doc = $state<Document>({
		kind: 'document',
		prefix: '',
		children: [{ kind, leadingTrivia: '', raw: `${SOURCE}\n` } as CstNode],
		suffix: ''
	});
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const overrides = normalizeKeybindingOverrides(keybindings);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(RevealLeafBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0], paint },
		context: editorMountContext({
			history,
			doc: { doc: () => doc },
			policies: { keybindingOverrides: () => overrides }
		})
	});
	flushSync();
	return {
		instance,
		doc,
		history,
		revealAtEnd: async () => {
			instance.parkCaret(SOURCE.length);
			await flush();
			const el = target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}

async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	await flush();
}

const pressEnter = (el: HTMLElement) => press(el, { key: 'Enter' });
const pressUndoChord = (el: HTMLElement) => press(el, { key: 'z', ctrlKey: true });

/** One typed character the way the engine delivers it: a collapsed target range at the caret. */
async function typeChar(el: HTMLElement, char: string): Promise<void> {
	const at = getCursorOffset(el) ?? (el.textContent ?? '').length;
	const e = new InputEvent('beforeinput', {
		inputType: 'insertText',
		data: char,
		bubbles: true,
		cancelable: true
	});
	const range = createRangeFromOffsets(el, asDomTextOffset(at), asDomTextOffset(at));
	Object.defineProperty(e, 'getTargetRanges', { value: () => (range ? [range] : []) });
	el.dispatchEvent(e);
	await flush();
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

describe('undo inside an open painted reveal', () => {
	it('walks the reveal’s own edits back before reaching the document’s history', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		await pressEnter(el);
		expect(el.textContent).toBe(`${SOURCE}\n`);

		await pressUndoChord(el);
		expect(el.textContent).toBe(SOURCE);
		expect(mounted.history.requestUndo).not.toHaveBeenCalled();

		await pressUndoChord(el);
		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});

	it('follows a host rebinding of the undo chord', async () => {
		mounted = mountLeaf([{ chord: 'Mod+Alt+U', command: 'history.undo' }]);
		const el = await mounted.revealAtEnd();
		await pressEnter(el);

		await press(el, { key: 'u', ctrlKey: true, altKey: true });

		expect(el.textContent).toBe(SOURCE);
		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});

	it('leaves a chord the host disabled to nobody', async () => {
		mounted = mountLeaf([{ chord: 'Mod+Z', command: null }]);
		const el = await mounted.revealAtEnd();
		await pressEnter(el);

		await pressUndoChord(el);

		expect(el.textContent).toBe(`${SOURCE}\n`);
		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});

	it('drops its entries once an external rewrite repaints the source', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		await pressEnter(el);

		mounted.doc.children[0].raw = '@@ two\n';
		flushSync();
		expect(el.textContent).toBe('@@ two');

		await pressUndoChord(el);
		expect(el.textContent).toBe('@@ two');
		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});
});

describe('a burst of typing inside an open painted reveal', () => {
	it('undoes as one entry, restoring the pre-burst text and caret', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		for (const char of 'abc') await typeChar(el, char);
		expect(el.textContent).toBe(`${SOURCE}abc`);

		await pressUndoChord(el);

		expect(el.textContent).toBe(SOURCE);
		expect(getCursorOffset(el)).toBe(SOURCE.length);
		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});

	it('opens a fresh entry once the typing pause has passed', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		await typeChar(el, 'a');
		await pause(UNDO_DEBOUNCE_MS + 50);
		await typeChar(el, 'b');

		await pressUndoChord(el);
		expect(el.textContent).toBe(`${SOURCE}a`);
		await pressUndoChord(el);
		expect(el.textContent).toBe(SOURCE);
	});

	it('closes the batch on an edit no keystroke could have made', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		await typeChar(el, 'a');
		await typeChar(el, 'b');
		await pressEnter(el);
		expect(el.textContent).toBe(`${SOURCE}ab\n`);

		await pressUndoChord(el);
		expect(el.textContent).toBe(`${SOURCE}ab`);
		await pressUndoChord(el);
		expect(el.textContent).toBe(SOURCE);
	});
});
