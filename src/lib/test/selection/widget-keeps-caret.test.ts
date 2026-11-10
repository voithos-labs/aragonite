// @vitest-environment jsdom
// Miss-analysis: selecting a widget cleared the browser's selection and every test pinned that, so
// none asked where text sent with no key would arrive, and a soft keyboard's letter was lost.
import { afterEach, describe, expect, it } from 'vitest';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { writeWidgetCaret } from '#lib/selection/widget-caret.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { checkWidgetKeepsCaret } from '#lib/invariants/widget-keeps-caret.js';
import { createSurfaceBackend } from '#lib/components/blocks/editable/surface-backend.js';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { mountBlock, span } from '../browser/chrome-fixtures';
import { takeDevWarns } from '../support/warn-gate';

const mounted: HTMLElement[] = [];
afterEach(() => {
	mounted.splice(0).forEach((el) => el.remove());
	window.getSelection()?.removeAllRanges();
});

/** A focusable block reading `lead ` then a five-byte widget then ` tail`. */
function block(): HTMLElement {
	const el = document.createElement('p');
	el.tabIndex = 0;
	el.innerHTML =
		'lead <span data-inline-widget="" data-source-start="5" data-source-end="10" contenteditable="false"></span> tail';
	document.body.append(el);
	mounted.push(el);
	return el;
}

const caret = () => {
	const sel = window.getSelection();
	return sel?.rangeCount ? { collapsed: sel.isCollapsed, node: sel.focusNode } : null;
};

function held(preSelectOffset: number) {
	const selection = createSelectionState();
	const el = block();
	const select = () =>
		selectWidgetWhole(
			selection,
			testCaretWriter,
			{ paragraphPath: [0], sourceStart: 5, preSelectOffset },
			() => el
		);
	return { selection, el, select };
}

describe('a widget selected whole keeps a caret at its edge', () => {
	it.each([
		['the edge it was entered from, its start', 5, 'lead '],
		['its end, where a click leaves it', 10, ' tail']
	])('in the focused block, at %s', (_name, edge, beside) => {
		const { el, select, selection } = held(edge);
		el.focus();
		select();
		expect(caret()).toEqual({ collapsed: true, node: expect.anything() });
		expect(caret()!.node!.textContent).toBe(beside);
		expect(checkWidgetKeepsCaret(el, false)).toBeNull();
		expect(selection.widget).not.toBeNull();
	});

	// Miss-analysis: every selected widget in a test had text beside its edge, so none kept its
	// caret among hidden markers, where the rule for a caret that shows refused it.
	it('among hidden marker runs, where a caret that shows is refused', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '@@marker'));
		mounted.push(el.parentElement!);
		el.focus();
		const target = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 };
		selectWidgetWhole(createSelectionState(), testCaretWriter, target, () => el);
		expect(caret()).toEqual({ collapsed: true, node: expect.anything() });
		expect(checkWidgetKeepsCaret(el, false)).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});

	it('holds none in a block that has no focus, where no text arrives', () => {
		const { el, select } = held(10);
		window.getSelection()!.collapse(el.firstChild, 0);
		select();
		expect(caret()).toBeNull();
	});

	it('holds none where the writer declines a caret, as reading mode does', () => {
		const { el, selection, select } = held(10);
		select();
		el.focus();
		const declines = createCaretWriter(
			() => {},
			() => true
		);
		writeWidgetCaret(selection, declines, () => el);
		expect(caret()).toBeNull();
		expect(checkWidgetKeepsCaret(el, true)).toBeNull();
	});
});

describe('G1.208 a widget selected whole in the focused block leaves the browser a caret there', () => {
	it('fails with no selection in the focused block', () => {
		const el = block();
		el.focus();
		window.getSelection()!.removeAllRanges();
		expect(checkWidgetKeepsCaret(el, false)?.code).toBe('widget-without-caret');
	});

	it('fails with the caret in another block', () => {
		const el = block();
		const other = block();
		el.focus();
		window.getSelection()!.collapse(other.firstChild, 0);
		expect(checkWidgetKeepsCaret(el, false)?.code).toBe('widget-without-caret');
	});

	it.each([
		['the block is not focused', (el: HTMLElement) => void el.blur(), false],
		['the block is not mounted', () => {}, false],
		['reading mode', (el: HTMLElement) => el.focus(), true]
	])('passes while %s', (name, arrange, reading) => {
		const el = block();
		arrange(el);
		expect(checkWidgetKeepsCaret(name.includes('mounted') ? null : el, reading)).toBeNull();
	});
});

describe('the caret a selected widget keeps is no read for its block', () => {
	it('every caret read answers as with no selection, and answers again once the widget goes', () => {
		const { el, select, selection } = held(10);
		const backend = createSurfaceBackend({
			getEl: () => el,
			caretWriter: testCaretWriter,
			holdsWidget: () => selection.widgetIn([0]) !== null
		});
		el.focus();
		select();
		expect([backend.getRaw(), backend.getFocusOffset(), backend.getRawSelection()]).toEqual([
			null,
			null,
			null
		]);
		selection.clearWidget();
		expect([backend.getRaw(), backend.getFocusOffset()]).toEqual([10, 10]);
	});
});
