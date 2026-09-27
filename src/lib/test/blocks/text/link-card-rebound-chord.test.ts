// @vitest-environment jsdom
// Inside the open link card, whatever chord opens the card is consumed and does nothing, so a
// consumer's rebinding never falls through to the browser's own action for that chord.
// Miss-analysis: the card's tests pressed only the default Mod+K, never a rebound chord.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	destroyMountedEditors
} from '$lib/test/harness/mount-editor.svelte';
import { dispatchKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

async function openCardWith(chord: KeyboardEventInit): Promise<HTMLInputElement> {
	const mounted = mountEditor({
		source: 'see [x](https://e.c) now\n',
		presentationMode: 'live',
		keybindings: [{ chord: 'Mod+L', command: 'link.openCard' }]
	});
	await pressKeyAt(mounted, [0], 5, chord);
	const field = document.querySelector<HTMLInputElement>('[data-link-card] input');
	if (!field) throw new Error('the link card did not open');
	return field;
}

describe('the link card takes the chords that open it', () => {
	it('takes a chord the consumer bound to link.openCard', async () => {
		const field = await openCardWith({ key: 'l', ctrlKey: true });

		expect(dispatchKey(field, { key: 'l', ctrlKey: true }).defaultPrevented).toBe(true);
	});

	it('still takes the default Mod+K', async () => {
		const field = await openCardWith({ key: 'k', ctrlKey: true });

		expect(dispatchKey(field, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
	});

	it('leaves a chord bound to nothing alone', async () => {
		const field = await openCardWith({ key: 'k', ctrlKey: true });

		expect(dispatchKey(field, { key: 'j', ctrlKey: true }).defaultPrevented).toBe(false);
	});
});
