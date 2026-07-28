// @vitest-environment jsdom
//
// The fence guard at its own entry layer: the mounted surface's real beforeinput,
// cut and compositionstart listeners, driven with a live DOM selection. The pure
// clamp is covered by code-fence-boundary.test.ts — what only this layer can prove
// is that the surface CLAIMS the native gesture (preventDefault) and commits the
// clamped text instead of letting the browser splice the fence away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets, getSelectionOffsets } from '$lib/cursor/content-offsets';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

// Async handlers finish after the dispatch returns; one macrotask drains the await
// chain (handleSharedBeforeInput) before the guard's commit is observable.
const settle = () => new Promise((r) => setTimeout(r));

// display "```js\nconst x = 1\n```": opener text [0,5) · body [6,17] · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';

function mountCodeBlock() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(SOURCE);
	const blockEdit = makeStubBlockEdit();

	const instance = mount(CodeBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();
	return { instance, el: target.querySelector('.code-block') as HTMLElement, blockEdit };
}

let mounted: ReturnType<typeof mountCodeBlock>;

function select(start: number, end: number): void {
	const range = createRangeFromOffsets(mounted.el, asDomTextOffset(start), asDomTextOffset(end));
	mounted.el.focus();
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range!);
}

function beforeInput(inputType: string, data?: string): InputEvent {
	const e = new InputEvent('beforeinput', {
		inputType,
		...(data === undefined ? {} : { data }),
		bubbles: true,
		cancelable: true
	});
	mounted.el.dispatchEvent(e);
	return e;
}

function replacement(transferred: string, data: string | null): InputEvent {
	const e = new InputEvent('beforeinput', {
		inputType: 'insertReplacementText',
		...(data === null ? {} : { data }),
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(e, 'dataTransfer', { value: { getData: () => transferred } });
	mounted.el.dispatchEvent(e);
	return e;
}

/** The committed display text, without the trailing line ending the surface reattaches. */
function committedText(): string {
	const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
	expect(calls.length).toBe(1);
	return (calls[0][1] as string).replace(/\n$/, '');
}

beforeEach(() => {
	mounted = mountCodeBlock();
});
afterEach(async () => {
	await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('CodeBlock — fence-crossing ranged edits', () => {
	it('claims a delete whose selection runs into the closer and commits the clamped text', async () => {
		select(12, 20);
		const e = beforeInput('deleteContentBackward');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst \n```');
	});

	it('claims a type-over and writes the typed character into the body', async () => {
		select(12, 20);
		const e = beforeInput('insertText', 'Z');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst Z\n```');
	});

	// The one claimed type whose payload is not on `e.data`: an autocorrect replacement
	// carries it on the dataTransfer.
	it('claims a replacement and writes its dataTransfer payload', async () => {
		select(12, 20);
		const e = replacement('Q', null);
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst Q\n```');
	});

	// getData answers a missing type with '' rather than null, so a nullish fallback
	// would take the empty string and silently turn the replacement into a delete.
	it('falls back to the event data when the dataTransfer carries no text', async () => {
		select(12, 20);
		replacement('', 'Q');
		await settle();

		expect(committedText()).toBe('```js\nconst Q\n```');
	});

	it('claims a soft break and splices it inside the body', async () => {
		select(12, 20);
		const e = beforeInput('insertLineBreak');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst \n\n```');
	});

	it('prevents a fence-only delete without spending a commit', async () => {
		select(18, 21); // the closer text plus nothing else is NOT crossing…
		const e = beforeInput('deleteContentBackward');
		await settle();
		expect(e.defaultPrevented).toBe(false);

		select(17, 18); // …but the body's own line ending is
		const prevented = beforeInput('deleteContentBackward');
		await settle();

		expect(prevented.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('leaves a selection inside one region to native handling', async () => {
		select(3, 5); // the info string
		const e = beforeInput('insertText', 'p');
		await settle();

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	// The gesture the browser ranges for us: the caret is collapsed and the pending
	// edit's target range covers a structural line ending. Chromium reports it through
	// getTargetRanges(); jsdom implements no such method, so the test supplies one.
	it('reads the pending edit from getTargetRanges, not the collapsed selection', async () => {
		select(6, 6);
		const e = new InputEvent('beforeinput', {
			inputType: 'deleteWordBackward',
			bubbles: true,
			cancelable: true
		});
		const target = createRangeFromOffsets(mounted.el, asDomTextOffset(3), asDomTextOffset(6));
		Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
		mounted.el.dispatchEvent(e);
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('cut deletes only the body part of a fence-crossing selection', async () => {
		select(12, 20);
		mounted.el.dispatchEvent(new Event('cut', { bubbles: true, cancelable: true }));
		await settle();

		expect(committedText()).toBe('```js\nconst \n```');
	});

	// Enter never reaches beforeinput — the keymap claims it at keydown — so its
	// splice carries the same span rule rather than inheriting the guard.
	it('Enter over a fence-crossing selection replaces only the body part', async () => {
		select(12, 20);
		mounted.el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await settle();

		expect(committedText()).toBe('```js\nconst \n\n```');
	});

	// beforeinput's insertCompositionText is not cancelable, so the guard cannot reach
	// an IME; the selection has to be shrunk before the composition owns the surface.
	it('compositionstart re-seats a fence-crossing selection onto the body', () => {
		select(12, 20);
		mounted.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

		expect(getSelectionOffsets(mounted.el)).toEqual({ start: 12, end: 17 });
	});
});
