// @vitest-environment jsdom
// Miss-analysis: `claimsChord` was a second computation no test held against the keydown handlers
// of the surfaces with no text block focused: the gap caret, the root, a range, the find bar, a card,
// and an open menu, which takes Escape at the document wherever the caret is.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineBlockView } from '#lib/plugin.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { registerBuiltInDescriptors } from '#lib/schema/built-in-descriptors.js';
import {
	installLayoutStubs,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { cellAt } from '../blocks/table/mount-table';
import { markerLeafPlugin } from '../plugins/fixtures/dom-views';
import {
	expectFocusAgrees,
	expectParity,
	keysToProbe,
	type ClaimContext,
	type Probe
} from './claims-parity';

beforeAll(installLayoutStubs);
// The host-field context leaves its input on the page.
afterEach(() => document.querySelectorAll('body > input').forEach((el) => el.remove()));
registerBuiltInDescriptors();

const PROSE = 'para text here\n\n# heading text\n\n| A | B |\n| --- | --- |\n| 1 | middle |\n';

// A hand-built block holding a button and a text field, the shape a plugin's own editor takes.
const badge = markerLeafPlugin(
	defineBlockView({
		surface: 'none',
		mount(target) {
			const button = document.createElement('button');
			button.textContent = 'badge';
			target.append(button, document.createElement('textarea'));
			return { destroy: () => target.replaceChildren() };
		}
	}),
	'claims-badge'
);

const TAG = { id: 'a', label: 'a', insert: '#a' };

const focusIn = (el: Element | null | undefined): HTMLElement => {
	if (!(el instanceof HTMLElement)) throw new Error('no element to focus');
	el.focus();
	return el;
};

async function openFindBar(editor: MountedEditor<Probe>): Promise<HTMLElement> {
	const para = surfaceAt(editor, [0]);
	placeCaret(para, 3);
	await pressKey(para, { key: 'f', ctrlKey: true });
	return focusIn(editor.target.querySelector('.search-input'));
}

async function caretInLink(editor: MountedEditor<Probe>): Promise<HTMLElement> {
	const para = surfaceAt(editor, [0]);
	placeCaret(para, 6);
	return para;
}

const CONTEXTS: ClaimContext[] = [
	{
		name: 'gap caret',
		focus: { at: 'gap', gap: { parentPath: [], index: 0 } },
		source: '```\ncode\n```\n\npara text here\n',
		enter: async (editor) => {
			const code = surfaceAt(editor, [0]);
			placeCaret(code, 0);
			await pressKey(code, { key: 'ArrowLeft' });
			expect(editor.instance.__test.getGapCaret()).not.toBeNull();
			return document.activeElement as HTMLElement;
		}
	},
	{
		name: 'a field of the host’s own',
		source: PROSE,
		focus: { at: 'outside' },
		enter: async () => focusIn(document.body.appendChild(document.createElement('input')))
	},
	{
		name: 'editor root focused',
		focus: { at: 'root' },
		source: PROSE,
		enter: async (editor) => focusIn(editor.target.querySelector('.editor'))
	},
	{
		name: 'reading-mode paragraph',
		source: PROSE,
		mode: 'reading',
		enter: async (editor) => focusIn(surfaceAt(editor, [0]))
	},
	{
		name: 'reading-mode table cell',
		source: PROSE,
		mode: 'reading',
		enter: async (editor) => focusIn(cellAt(editor, 1, 1, [2]))
	},
	{
		name: 'range across blocks',
		source: PROSE,
		enter: async (editor) => {
			focusIn(surfaceAt(editor, [0]));
			await editor.instance.setSelection({
				anchor: { path: [0], offset: 2 },
				focus: { path: [1], offset: 4 }
			});
			await editor.settle();
			return document.activeElement as HTMLElement;
		}
	},
	{
		name: 'range across task items',
		source: '- [ ] one item\n- [ ] two item\n- [ ] three item\n',
		enter: async (editor) => {
			focusIn(surfaceAt(editor, [0, 0, 0]));
			await editor.instance.setSelection({
				anchor: { path: [0, 0, 0], offset: 2 },
				focus: { path: [0, 1, 0], offset: 4 }
			});
			await editor.settle();
			return document.activeElement as HTMLElement;
		}
	},
	{ name: 'find bar', source: PROSE, focus: { at: 'find-bar' }, enter: openFindBar },
	{
		name: 'paragraph under an open inline menu, Tab and Enter freed there',
		source: PROSE,
		mode: 'live',
		keybindings: [
			{ kind: 'paragraph', chord: 'Tab', command: null },
			{ kind: 'paragraph', chord: 'Enter', command: null }
		],
		enter: async (editor) => {
			const menus = editor.instance.getInlineMenus();
			menus.addSource({ name: 'tags', trigger: '#', items: () => [TAG, { ...TAG, id: 'b' }] });
			const para = surfaceAt(editor, [0]);
			placeCaret(para, 4);
			menus.open('tags');
			await editor.settle();
			expect(document.querySelector('[role="option"]')).not.toBeNull();
			return para;
		}
	},
	{
		name: 'live caret in a link',
		source: 'see [link](https://x.test) here\n',
		mode: 'live',
		enter: caretInLink
	},
	{
		name: 'open link card',
		focus: { at: 'field', path: null },
		source: 'see [link](https://x.test) here\n',
		mode: 'live',
		enter: async (editor) => {
			const para = await caretInLink(editor);
			await pressKey(para, { key: 'k', ctrlKey: true });
			const input = editor.target.querySelector('[data-link-card] input');
			expect(document.activeElement).toBe(input);
			return input as HTMLElement;
		}
	},
	{
		name: 'paragraph in a plugin container',
		source: ':::note\n\nTip text here\n\n:::\n',
		plugins: [admonitionsPlugin()],
		pluginChords: ['Mod+7'],
		enter: async (editor) => {
			const leaves = editor.target.querySelectorAll<HTMLElement>('[contenteditable]');
			const tip = [...leaves].find((el) => el.textContent === 'Tip text here');
			if (!tip) throw new Error('no paragraph inside the admonition');
			placeCaret(tip, 4);
			return tip;
		}
	},
	{
		name: 'hand-built block button',
		source: 'intro\n\n@@ badge\n\noutro\n',
		plugins: [badge],
		enter: async (editor) => focusIn(editor.target.querySelector('[data-block-path="[1]"] button'))
	},
	{
		name: 'hand-built block text field',
		focus: { at: 'field', path: [1] },
		source: 'intro\n\n@@ badge\n\noutro\n',
		plugins: [badge],
		enter: async (editor) =>
			focusIn(editor.target.querySelector('[data-block-path="[1]"] textarea'))
	}
];

describe('claimsChord reads the focus its handler stands at', () => {
	it.each(CONTEXTS.filter((context) => context.focus))('$name', expectFocusAgrees);
});

describe.each(CONTEXTS)('claimsChord agrees with the keydown: $name', (context) => {
	const keys = [...keysToProbe(), ...(context.pluginChords ?? [])];
	it.each(keys)('%s', (chord) => expectParity(context, chord));
});
