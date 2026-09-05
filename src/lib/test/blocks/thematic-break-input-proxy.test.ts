// @vitest-environment jsdom
//
// Regression pin for #144: a printable that arrives as `beforeinput` rather than a plain keydown
// — an AltGr production, an IME commit — was dropped whole at a whole-block-focused kind, whose
// focused element was a bare `tabindex=0` div with no editing host under it.
//
// Miss-analysis: `whole-block-keys.test.ts` pinned every branch of the keydown tail, and the tail
// IS the whole mint; no test asked whether the other input door existed at all.
import { describe, it, expect, afterEach } from 'vitest';
import { BREAK_INDEX as INDEX, mountBreak, type MountedBreak } from './mount-break';

/** The shape an AltGr production arrives in: no keydown branch admits it, so the editing host is
 *  the only door it has. */
function beforeInput(host: HTMLElement, data: string): InputEvent {
	const event = new InputEvent('beforeinput', {
		bubbles: true,
		cancelable: true,
		inputType: 'insertText',
		data
	});
	host.dispatchEvent(event);
	return event;
}

function compose(host: HTMLElement, text: string): void {
	host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	host.textContent = text;
	host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
}

let mounted: MountedBreak;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('thematic break — the hidden editing host', () => {
	it('mounts inside the block and takes the whole-block focus landing', () => {
		mounted = mountBreak();
		expect(mounted.host).not.toBeNull();
		expect(mounted.host.getAttribute('contenteditable')).toBe('true');

		mounted.instance.parkCaret(0);

		expect(document.activeElement).toBe(mounted.host);
		expect(mounted.instance.getCursorOffset()).toBe(0);
	});

	it('mints a paragraph below carrying an AltGr production the keydown gate drops', () => {
		mounted = mountBreak();
		mounted.instance.parkCaret(0);

		const event = beforeInput(mounted.host, '€');

		expect(mounted.blockEdit.insertParagraph).toHaveBeenCalledWith(INDEX + 1, '€');
		expect(event.defaultPrevented).toBe(true);
	});

	it('mints the composed text on commit and leaves the host empty', () => {
		mounted = mountBreak();
		mounted.instance.parkCaret(0);

		compose(mounted.host, '日本');

		expect(mounted.blockEdit.insertParagraph).toHaveBeenCalledWith(INDEX + 1, '日本');
		expect(mounted.host.textContent).toBe('');
	});

	// An aborted composition ends with nothing committed; minting there would leave an empty
	// paragraph behind every cancelled IME session.
	it('mints nothing when a composition ends with no text', () => {
		mounted = mountBreak();
		mounted.instance.parkCaret(0);

		compose(mounted.host, '');

		expect(mounted.blockEdit.insertParagraph).not.toHaveBeenCalled();
	});

	it('mid-composition input is left to the browser, so the IME keeps its preedit', () => {
		mounted = mountBreak();
		mounted.instance.parkCaret(0);
		mounted.host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

		const event = beforeInput(mounted.host, 'に');

		expect(mounted.blockEdit.insertParagraph).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('reading mode takes the keystroke and writes no byte', () => {
		mounted = mountBreak('reading');
		mounted.instance.parkCaret(0);

		expect(mounted.host.getAttribute('contenteditable')).toBe('false');
		beforeInput(mounted.host, '€');

		expect(mounted.blockEdit.insertParagraph).not.toHaveBeenCalled();
	});
});
