// @vitest-environment jsdom
//
// The chip's commit gate, at the only layer holding both the field and the write sink —
// `writeFenceInfo` takes an info string and cannot see that the field never changed one.
// Miss-analysis: every commit test typed a new language, so no test ever pressed Enter on
// an untouched field, and the byte comparison passed for the unpadded fence they all used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { mountCode, type MountedCode } from './mount-code';

// Trailing spaces the parser trims out of `meta.info` and keeps in the block's bytes.
const PADDED = '```js  \nconst x = 1\n```\n';

let mounted: MountedCode;

/** Click the chip, returning the picker's search field. The chip itself no longer swaps for
 *  a field — it stays a fixed button and the field lives in the menu, so opening moves nothing. */
function openField(): HTMLInputElement {
	const button = mounted.target.querySelector('.code-lang-button') as HTMLButtonElement;
	button.click();
	flushSync();
	return mounted.target.querySelector('.code-lang-picker input') as HTMLInputElement;
}

function pressEnter(field: HTMLInputElement): void {
	field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	flushSync();
}

function commits(): string[] {
	return vi
		.mocked(mounted.blockEdit.updateBlockContent)
		.mock.calls.map((call) => call[1] as string);
}

beforeEach(() => {
	mounted = mountCode(PADDED, { policies: { presentationMode: () => 'live' } });
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock — the language chip’s commit gate', () => {
	// The field opens EMPTY and the highlight seats on the block's own language, so a bare
	// Enter re-commits `js` — which the gate reads as unchanged and writes nothing, padding
	// and all.
	it('writes nothing when Enter submits the language the block already has', () => {
		const field = openField();
		expect(field.value).toBe('');
		expect(mounted.target.querySelector('.code-lang-button')?.textContent).toContain('js');

		pressEnter(field);

		expect(commits()).toEqual([]);
	});

	it('writes a changed info string, canonicalizing the padding it replaces', () => {
		const field = openField();
		field.value = 'ts';
		field.dispatchEvent(new Event('input', { bubbles: true }));

		pressEnter(field);

		expect(commits()).toEqual(['```ts\nconst x = 1\n```\n']);
	});
});
