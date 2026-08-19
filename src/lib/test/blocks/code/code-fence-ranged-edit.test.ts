// @vitest-environment jsdom
//
// The fence guard at its own entry layer: the mounted surface's real beforeinput,
// cut and compositionstart listeners, driven with a live DOM selection. The pure
// clamp is covered by code-fence-boundary.test.ts — what only this layer can prove
// is that the surface CLAIMS the native gesture (preventDefault) and commits the
// clamped text instead of letting the browser splice the fence away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import {
	createRangeFromOffsets,
	getRangeOffsets,
	getSelectionOffsets
} from '$lib/cursor/content-offsets';
import { mountCode, type MountedCode } from './mount-code';

// Async handlers finish after the dispatch returns; one macrotask drains the await
// chain (handleSharedBeforeInput) before the guard's commit is observable.
const settle = () => new Promise((r) => setTimeout(r));

// display "```js\nconst x = 1\n```": opener text [0,5) · body [6,17] · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';

let mounted: MountedCode;

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

function replacement(transferred: string): InputEvent {
	const e = new InputEvent('beforeinput', {
		inputType: 'insertReplacementText',
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
	mounted = mountCode(SOURCE);
});
afterEach(async () => {
	await mounted.dispose();
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

	// A replacement carries its payload on the dataTransfer, which this surface never reads: a
	// payload it did not read cannot go through the paste transforms (G4.11), so it is refused.
	it('refuses a replacement rather than re-siting a payload it never read', async () => {
		select(12, 20);
		const e = replacement('Q');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('claims a soft break and splices it inside the body', async () => {
		select(12, 20);
		const e = beforeInput('insertLineBreak');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst \n\n```');
	});

	// The keydown path auto-indents (computeCodeEnter 'normal'); a mobile/IME
	// insertParagraph is the same gesture and keeps the indent.
	it('claims a paragraph break and keeps the body line indent', async () => {
		await mounted.dispose();
		mounted = mountCode('```js\n  const x = 1\n```\n');
		select(14, 22);
		const e = beforeInput('insertParagraph');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\n  const \n  \n```');
	});

	it('prevents a fence-only delete without spending a commit', async () => {
		for (const [start, end] of [
			[17, 18], // the body's own line ending
			[18, 21], // the closer text — structure, not content
			[0, 3] // the opener's marker run
		]) {
			select(start, end);
			const e = beforeInput('deleteContentBackward');
			await settle();

			expect(e.defaultPrevented).toBe(true);
			expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		}
	});

	// Parser-verified: one typed character inside the closer run leaves an unclosed
	// fence that swallows every following block.
	it('prevents a collapsed-caret insertion inside the closer run', async () => {
		select(19, 19);
		const e = beforeInput('insertText', 'x');
		await settle();

		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('leaves a selection inside one region to native handling', async () => {
		select(3, 5); // the info string
		const e = beforeInput('insertText', 'p');
		await settle();

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	// The pending edit's target range covers a structural line ending. Chromium reports it
	// through getTargetRanges(); jsdom implements no such method, so the test supplies one.
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

	// A target range reaching outside this block is a cross-block edit the surface cannot
	// measure, so it declines rather than guessing an offset.
	it('declines a target range that leaves the surface', async () => {
		select(12, 20);
		const foreign = document.createElement('div');
		foreign.textContent = 'elsewhere';
		document.body.appendChild(foreign);
		const target = document.createRange();
		target.setStart(mounted.el.firstChild!, 0);
		target.setEnd(foreign.firstChild!, 3);

		const e = new InputEvent('beforeinput', {
			inputType: 'deleteContentBackward',
			bubbles: true,
			cancelable: true
		});
		Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
		mounted.el.dispatchEvent(e);
		await settle();

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		foreign.remove();
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

	// A landing door must seat a caret that can type: the cross-container merge fallback moves
	// focus to this block's END, which is the closer run, where every keystroke is refused.
	it.each([
		['past the display end', 999, 17],
		['at offset 0', 0, 6]
	])('focus %s seats the caret in the body, where typing lands', async (_label, asked, seated) => {
		(mounted.instance as unknown as { focus(offset: number): void }).focus(asked);

		const range = window.getSelection()!.getRangeAt(0);
		expect(getRangeOffsets(mounted.el, range)).toEqual({ start: seated, end: seated });

		// The guard declines here, which is what "typable" means on this surface.
		const e = beforeInput('insertText', 'X');
		await settle();
		expect(e.defaultPrevented).toBe(false);
	});

	// beforeinput's insertCompositionText is not cancelable, so the guard cannot reach
	// an IME; the selection has to be shrunk before the composition owns the surface.
	it('compositionstart re-seats a fence-crossing selection onto the body', () => {
		select(12, 20);
		mounted.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

		expect(getSelectionOffsets(mounted.el)).toEqual({ start: 12, end: 17 });
	});
});
