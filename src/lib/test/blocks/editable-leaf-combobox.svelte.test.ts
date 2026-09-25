// @vitest-environment jsdom
//
// Miss-analysis: what a prose editable says about an open inline menu was asserted only on the
// built-in paragraph, so the other editable the editor ships, the one a plugin builds with
// `createEditableLeaf`, was never asked and could say nothing at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unmount, flushSync } from 'svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { InlineMenuCombobox } from '$lib/inline-menu/inline-menu-state.svelte';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'combobox-leaf';
const SOURCE = '@@ one';
const OPEN: InlineMenuCombobox = { listboxId: 'editor-1-inline-menu', activeOptionId: 'row-inbox' };

function mountLeaf() {
	const kind = registerRevealLeafKind(KIND, { supportsInline: true });
	// Reactive, the way the editor's own state is: the list opens and closes under a mounted leaf.
	let combobox = $state.raw<InlineMenuCombobox | null>(null);
	const mounted = mountRevealLeaf(leafDocument(kind, `${SOURCE}\n`), {
		overrides: { services: { inlineMenuCombobox: () => combobox } }
	});
	return {
		...mounted,
		openList(next: InlineMenuCombobox | null) {
			combobox = next;
			flushSync();
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
