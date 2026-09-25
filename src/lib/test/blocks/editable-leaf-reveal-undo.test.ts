// @vitest-environment jsdom
//
// Miss-analysis: the reveal's own undo read Mod+Z off the keydown by hand, so nothing at this
// level could ask what a host's rebind or disable does to it; the reserved-chords manifest was
// the only thing that noticed, one layer away from the behaviour.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unmount } from 'svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'reveal-undo-leaf';
const SOURCE = '@@ one two';
const RAW = `${SOURCE}\n`;

function mountLeaf(overrides: KeybindingOverride[] = []) {
	const kind = registerRevealLeafKind(KIND);
	const keybindings = normalizeKeybindingOverrides(overrides);
	return mountRevealLeaf(leafDocument(kind, RAW), {
		props: {
			paint: (text: string) => {
				const fragment = document.createDocumentFragment();
				fragment.append(document.createTextNode(text));
				return fragment;
			}
		},
		overrides: { policies: { keybindingOverrides: () => keybindings } }
	});
}

/** One edit of the reveal's own: the Enter a painted multi-line source keeps as a newline. */
async function editOnce(el: HTMLElement): Promise<void> {
	await pressKey(el, { key: 'Enter' });
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
		await pressKey(el, { key: 'z', ctrlKey: true });
		expect(el.textContent).toBe(SOURCE);
	});

	it('answers a rebound chord, and a globally disabled Mod+Z no longer', async () => {
		mounted = mountLeaf([
			{ chord: 'Mod+Z', command: null },
			{ chord: 'Mod+Alt+U', command: 'history.undo' }
		]);
		const el = await mounted.revealAtEnd();
		await editOnce(el);
		await pressKey(el, { key: 'z', ctrlKey: true });
		expect(el.textContent).toBe(`${SOURCE}\n`);
		await pressKey(el, { key: 'u', ctrlKey: true, altKey: true });
		expect(el.textContent).toBe(SOURCE);
	});
});
