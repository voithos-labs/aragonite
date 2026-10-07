// @vitest-environment jsdom
// What the language chip commits, at the only layer holding both the field and the write, since
// `writeFenceInfo` takes an info string and cannot see that the field never changed one.
// Miss-analysis: every commit test typed a new language on an unpadded fence, never a bare Enter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { mountCode, type MountedCode } from './mount-code';
import { dispatchKey } from '$lib/test/harness/settle';
import { makeStubController } from '$lib/test/harness/editor-actions';

// Trailing spaces the parser trims out of `meta.info` and keeps in the block's bytes.
const PADDED = '```js  \nconst x = 1\n```\n';

let mounted: MountedCode;

/** Click the chip, returning the picker's search field; the chip stays a fixed button and the
 *  field lives in the menu. */
function openField(): HTMLInputElement {
	const button = mounted.target.querySelector('.code-lang-button') as HTMLButtonElement;
	button.click();
	flushSync();
	return mounted.target.querySelector('.code-lang-picker input') as HTMLInputElement;
}

function typeInto(field: HTMLInputElement, value: string): void {
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(field: HTMLInputElement): void {
	dispatchKey(field, { key: 'Enter' });
	flushSync();
}

function commits(): string[] {
	return vi
		.mocked(mounted.blockEdit.updateBlockContent)
		.mock.calls.map((call) => call[1] as string);
}

afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock: the language chip’s commit gate', () => {
	// The field opens empty with the highlight on the block's own language, so a bare Enter
	// re-commits `js`, which reads as unchanged and writes nothing, padding and all.
	it('writes nothing when Enter submits the language the block already has', () => {
		mounted = mountCode(PADDED, { policies: { presentationMode: () => 'live' } });
		const field = openField();
		expect(field.value).toBe('');
		expect(mounted.target.querySelector('.code-lang-button')?.textContent).toContain('js');

		pressEnter(field);

		expect(commits()).toEqual([]);
	});

	it('writes a changed info string, canonicalizing the padding it replaces', () => {
		mounted = mountCode(PADDED, { policies: { presentationMode: () => 'live' } });
		const field = openField();
		typeInto(field, 'ts');

		pressEnter(field);

		expect(commits()).toEqual(['```ts\nconst x = 1\n```\n']);
	});
});

// The picker's field is free text, so the helper behind the commit decides what reaches the line.
describe('CodeBlock: bytes the chip’s info string cannot hold', () => {
	it.each([
		[
			'a backtick on an unclosed backtick fence',
			'```js\nconst x = 1\n',
			'a`b',
			'```ab\nconst x = 1\n'
		],
		[
			'a leading fence marker on a tilde fence',
			'~~~js\nconst x = 1\n~~~\n',
			'~~ts',
			'~~~ts\nconst x = 1\n~~~\n'
		]
	])('drops %s from what it writes', (_shape, source, typed, written) => {
		mounted = mountCode(source, { policies: { presentationMode: () => 'live' } });
		const field = openField();
		typeInto(field, typed);

		pressEnter(field);

		expect(commits()).toEqual([written]);
	});
});

// Miss-analysis: a browser click between typing and the commit outruns the batching window by
// itself, so no e2e undo row failed when the commit stopped being kept apart.
describe('CodeBlock: the language chip’s undo entry', () => {
	it('writes through the controller’s isolated entry, and only when it writes', () => {
		const controller = makeStubController();
		const writesInside: number[] = [];
		vi.mocked(controller.isolateUndoEntry).mockImplementation((write) => {
			const before = commits().length;
			write();
			writesInside.push(commits().length - before);
		});
		mounted = mountCode(PADDED, {
			policies: { presentationMode: () => 'live' },
			services: { controller }
		});

		pressEnter(openField());
		expect(controller.isolateUndoEntry).not.toHaveBeenCalled();

		const field = openField();
		typeInto(field, 'ts');
		pressEnter(field);

		expect(writesInside).toEqual([1]);
		expect(commits()).toHaveLength(1);
	});
});
