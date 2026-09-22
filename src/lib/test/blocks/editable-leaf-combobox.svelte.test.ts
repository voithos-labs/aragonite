// @vitest-environment jsdom
//
// Miss-analysis: what a prose editable says about an open inline menu was asserted only on the
// built-in paragraph, so the other editable the editor ships, the one a plugin builds with
// `createEditableLeaf`, was never asked and could say nothing at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import type { InlineMenuCombobox } from '$lib/inline-menu/inline-menu-state.svelte';
import { editorMountContext } from '../harness/mount-context';
import { installLayoutStubs } from './editor-mount';

const KIND = 'combobox-leaf';
const SOURCE = '@@ one';
const OPEN: InlineMenuCombobox = { listboxId: 'editor-1-inline-menu', activeOptionId: 'row-inbox' };

/** Drains the microtask queue the reveal runs on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

function mountLeaf() {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: true,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	const node: CstNode = { kind, leadingTrivia: '', raw: `${SOURCE}\n` } as CstNode;
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	// Reactive, the way the editor's own state is: the list opens and closes under a mounted leaf.
	let combobox = $state.raw<InlineMenuCombobox | null>(null);
	const target = document.createElement('div');
	document.body.appendChild(target);

	const instance = mount(RevealLeafBlock, {
		target,
		props: { node, index: 0, myPath: [0] },
		context: editorMountContext({
			doc: { doc: () => doc },
			services: { inlineMenuCombobox: () => combobox }
		})
	});
	flushSync();

	return {
		instance,
		target,
		openList(next: InlineMenuCombobox | null) {
			combobox = next;
			flushSync();
		},
		/** Show the source with the caret at the end of the block's bytes. */
		async revealAtEnd() {
			instance.parkCaret(SOURCE.length);
			await flush();
			const el = target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) {
		await unmount(mounted.instance);
		mounted.target.remove();
	}
	mounted = null;
});

describe('a plugin’s editable leaf and an open inline menu', () => {
	it('reads as a plain text box while no list shows in it', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();

		expect(el.getAttribute('role')).toBe('textbox');
		expect(el.hasAttribute('aria-expanded')).toBe(false);
		expect(el.hasAttribute('aria-controls')).toBe(false);
		expect(el.hasAttribute('aria-activedescendant')).toBe(false);
		expect(el.hasAttribute('aria-autocomplete')).toBe(false);
	});

	it('names the list and its active row while one shows, and drops both when it goes', async () => {
		mounted = mountLeaf();
		const el = await mounted.revealAtEnd();

		mounted.openList(OPEN);
		expect(el.getAttribute('role')).toBe('combobox');
		expect(el.getAttribute('aria-expanded')).toBe('true');
		expect(el.getAttribute('aria-controls')).toBe(OPEN.listboxId);
		expect(el.getAttribute('aria-activedescendant')).toBe(OPEN.activeOptionId);
		expect(el.getAttribute('aria-autocomplete')).toBe('list');

		mounted.openList({ ...OPEN, activeOptionId: 'row-work' });
		expect(el.getAttribute('aria-activedescendant')).toBe('row-work');

		mounted.openList(null);
		expect(el.getAttribute('role')).toBe('textbox');
		expect(el.hasAttribute('aria-expanded')).toBe(false);
		expect(el.hasAttribute('aria-controls')).toBe(false);
		expect(el.hasAttribute('aria-activedescendant')).toBe(false);
		expect(el.hasAttribute('aria-autocomplete')).toBe(false);
	});
});
