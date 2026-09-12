// @vitest-environment jsdom
//
// Miss-analysis: the reveal's own undo read Mod+Z off the keydown by hand, so nothing at this
// level could ask what a host's rebind or disable does to it; the reserved-chords manifest was
// the only thing that noticed, one layer away from the behaviour.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import { makeStubBlockEdit } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';
import { installLayoutStubs } from './editor-mount';

const KIND = 'reveal-undo-leaf';
const SOURCE = '@@ one two';
const RAW = `${SOURCE}\n`;

/** Drains the microtask queue the async keydown handler and the reveal both run on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

function mountLeaf(overrides: KeybindingOverride[] = []) {
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

	const node: CstNode = { kind, leadingTrivia: '', raw: RAW } as CstNode;
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	const target = document.createElement('div');
	document.body.appendChild(target);
	const keybindings = normalizeKeybindingOverrides(overrides);

	const instance = mount(RevealLeafBlock, {
		target,
		props: {
			node,
			index: 0,
			myPath: [0],
			paint: (text: string) => {
				const fragment = document.createDocumentFragment();
				fragment.append(document.createTextNode(text));
				return fragment;
			}
		},
		context: editorMountContext({
			blockEdit: makeStubBlockEdit(),
			doc: { doc: () => doc },
			policies: { keybindingOverrides: () => keybindings }
		})
	});
	flushSync();

	return {
		instance,
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

/** One edit of the reveal's own: the Enter a painted multi-line source keeps as a newline. */
async function editOnce(el: HTMLElement): Promise<void> {
	await press(el, { key: 'Enter' });
	expect(el.textContent).toBe(`${SOURCE}\n`);
}

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(() => {
	if (mounted) void unmount(mounted.instance);
	mounted = null;
	document.body.replaceChildren();
});

describe("an open reveal's own undo answers the keymap, not a hardcoded chord", () => {
	it('steps the edit back on the default undo chord', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();
		await editOnce(el);
		await press(el, { key: 'z', ctrlKey: true });
		expect(el.textContent).toBe(SOURCE);
	});

	it('answers a rebound chord, and a globally disabled Mod+Z no longer', async () => {
		mounted = mountLeaf([
			{ chord: 'Mod+Z', command: null },
			{ chord: 'Mod+Alt+U', command: 'history.undo' }
		]);
		const el = await mounted.revealAtEnd();
		await editOnce(el);
		await press(el, { key: 'z', ctrlKey: true });
		expect(el.textContent).toBe(`${SOURCE}\n`);
		await press(el, { key: 'u', ctrlKey: true, altKey: true });
		expect(el.textContent).toBe(SOURCE);
	});
});
