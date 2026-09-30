// @vitest-environment jsdom
// Backspace in a painted leaf with nothing in it deletes the block and leaves the caret to the
// delete, which lands at the end of the block above; the leaf moves no caret of its own.
// Miss-analysis: no test pressed that Backspace, so its second caret move after the delete was
// never counted.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { recordingFocus } from '$lib/testing/headless-actions';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'backspace-leaf';

function paint(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	frag.appendChild(document.createTextNode(text));
	return frag;
}

let dispose: (() => Promise<void>) | null = null;

beforeEach(() => {
	installLayoutStubs();
});

afterEach(async () => {
	await dispose?.();
	dispose = null;
	document.body.innerHTML = '';
});

describe('Backspace in an empty painted leaf', () => {
	it('deletes the block toward the block above and moves no caret itself', async () => {
		const focus = recordingFocus();
		const mounted = mountRevealLeaf(leafDocument(registerRevealLeafKind(KIND), '\n'), {
			props: { paint },
			overrides: { focus }
		});
		dispose = mounted.dispose;
		const el = await mounted.revealAtEnd();

		await pressKey(el, { key: 'Backspace' });

		expect(mounted.blockEdit.deleteBlock.mock.calls).toEqual([[0, 'Backspace']]);
		expect(focus.moveFocusCalls).toEqual([]);
	});
});
