// @vitest-environment jsdom
// The fence check through the mounted block's real listeners with a live DOM selection, in live
// mode, which hides the fence lines: the range it reads, the text it inserts, a collapsed caret on
// a fence line and where a refused gesture leaves the caret. The span each write route takes over
// a range is in `code-fence-edit-span.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { createSurfaceBackend } from '$lib/cursor/surface-backend';
import { mountCode, type MountedCode } from './mount-code';
import { settleEditor } from '$lib/test/harness/settle';

// display "```js\nconst x = 1\n```": opener text [0,5) · body [6,17] · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';

/** Live mode hides every fence line, so an edit that reaches one clamps to the body. */
const HIDDEN_FENCE_LINES = { policies: { presentationMode: () => 'live' as const } };

let mounted: MountedCode;

function select(start: number, end: number): void {
	const range = createRangeAtDomTextOffsets(
		mounted.el,
		asDomTextOffset(start),
		asDomTextOffset(end)
	);
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

/** The committed displayed text, without the trailing line ending that is reattached. */
function committedText(): string {
	const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
	expect(calls.length).toBe(1);
	return (calls[0][1] as string).replace(/\n$/, '');
}

beforeEach(() => {
	mounted = mountCode(SOURCE, HIDDEN_FENCE_LINES);
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock: fence-crossing ranged edits', () => {
	// A replacement carries its payload on the `dataTransfer`, which is never read here: a
	// payload it did not read cannot go through the paste transforms (G4.11), so it is refused.
	it('refuses a replacement rather than re-siting a payload it never read', async () => {
		select(12, 20);
		const e = replacement('Q');
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('claims a soft break and splices it inside the body', async () => {
		select(12, 20);
		const e = beforeInput('insertLineBreak');
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\nconst \n\n```');
	});

	// The keydown path auto-indents (computeCodeEnter 'normal'); a mobile/IME
	// insertParagraph is the same gesture and keeps the indent.
	it('claims a paragraph break and keeps the body line indent', async () => {
		await mounted.dispose();
		mounted = mountCode('```js\n  const x = 1\n```\n', HIDDEN_FENCE_LINES);
		select(14, 22);
		const e = beforeInput('insertParagraph');
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
		expect(committedText()).toBe('```js\n  const \n  \n```');
	});

	// Parser-verified: one typed character inside the closer run leaves an unclosed
	// fence that swallows every following block.
	it('prevents a collapsed-caret insertion inside the closer run', async () => {
		select(19, 19);
		const e = beforeInput('insertText', 'x');
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
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
		const target = createRangeAtDomTextOffsets(mounted.el, asDomTextOffset(3), asDomTextOffset(6));
		Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
		mounted.el.dispatchEvent(e);
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	// A target range reaching outside this block is a cross-block edit this block cannot
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
		await settleEditor();

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		foreign.remove();
	});

	// Enter is a command, so the dispatch removes the selection first through the block's fenced
	// removal; the bytes the newline then writes are pinned in `break-over-selection.test.ts`.
	it('Enter over a fence-crossing selection first removes only the body part', async () => {
		select(12, 20);
		mounted.el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await settleEditor();

		const [removal] = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
		expect(removal[1]).toBe('```js\nconst \n```\n');
	});

	// Focus must leave a caret that can type: the cross-container merge fallback moves
	// focus to this block's end, which is the closer run, where every keystroke is refused.
	it.each([
		['past the display end', 999, 17],
		['at offset 0', 0, 6]
	])('focus %s seats the caret in the body, where typing lands', async (_label, asked, seated) => {
		(mounted.instance as unknown as { focus(offset: number): void }).focus(asked);

		const range = window.getSelection()!.getRangeAt(0);
		expect(createSurfaceBackend({ getEl: () => mounted.el }).rawRangeOf(range)).toEqual({
			start: seated,
			end: seated
		});

		// The check refuses here, which is what "can be typed into" means for this block.
		const e = beforeInput('insertText', 'X');
		await settleEditor();
		expect(e.defaultPrevented).toBe(false);
	});

	it('compositionstart over fence structure alone collapses onto the body and writes nothing', () => {
		select(18, 21);
		mounted.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

		expect(createSurfaceBackend({ getEl: () => mounted.el }).getRaw()).toBe(17);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});

// Miss-analysis: no fence-edit test put an edit on a fence line the mode paints.
describe('CodeBlock: a fence line the mode paints takes the edit', () => {
	// Source mode is in `code-fence-edit-span.test.ts`; preview-block paints the focused block's
	// markers too, so its fence lines show.
	it('leaves a delete into the closer to the browser in preview-block', async () => {
		await mounted.dispose();
		mounted = mountCode(SOURCE, { policies: { presentationMode: () => 'preview-block' } });
		select(12, 20);
		const e = beforeInput('deleteContentBackward');
		await settleEditor();

		expect(e.defaultPrevented).toBe(false);
	});
});

// Live mode is the one editable mode that hides the fence lines, and no pointer or arrow puts a
// caret on them there, so these refusals are driven here rather than end to end.
describe('CodeBlock: a gesture confined to a hidden fence line does nothing', () => {
	/** A clipboard event with a plain-text payload, returning what the handler wrote back. */
	function clipboardEvent(type: 'cut' | 'paste', text = ''): Map<string, string> {
		const data = new Map([['text/plain', text]]);
		const e = new Event(type, { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'clipboardData', {
			value: {
				getData: (format: string) => data.get(format) ?? '',
				setData: (format: string, value: string) => data.set(format, value),
				files: [],
				items: [],
				types: ['text/plain']
			}
		});
		mounted.el.dispatchEvent(e);
		return data;
	}

	const commits = () => vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls.length;

	it('Backspace inside the closer run is taken and commits nothing', async () => {
		select(20, 20);
		const e = beforeInput('deleteContentBackward');
		await settleEditor();

		expect(e.defaultPrevented).toBe(true);
		expect(commits()).toBe(0);
	});

	it.each([
		['with the caret inside the closer run', 19, 19],
		['with the caret inside the opener run', 1, 1]
	])('a paste %s commits nothing', async (_label, start, end) => {
		select(start, end);
		clipboardEvent('paste', 'Y');
		await settleEditor();

		expect(commits()).toBe(0);
	});
});
