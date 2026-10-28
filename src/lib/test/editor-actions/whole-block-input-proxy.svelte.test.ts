// @vitest-environment jsdom
import { createCompositionTracker } from '#lib/browser/composition.js';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { allowDevWarns, takeDevWarns } from '#lib/test/support/warn-gate.js';
import { serialize } from '#lib/core/serializer.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { createContainerBlockComponent } from '#lib/editor-actions/container-block-component.js';
import {
	composeWholeBlockFocusSurface,
	createWholeBlockInputProxy,
	holdsWholeBlockFocus,
	isEditableEventTarget,
	type WholeBlockInputProxy
} from '#lib/editor-actions/whole-block-focus-surface.svelte.js';
import {
	WHOLE_BLOCK_INPUT_ATTR,
	isWholeBlockInputProxy
} from '#lib/selection/whole-block-input.js';
import type { AnyBlockKind, CstNode } from '#lib/core/nodes.js';
import { makeShimDeps, makeTopHarness } from '#lib/test/harness/editor-actions.js';

/** The tab stop the editor's reading focus would hold: the host stays in the tab order. */
const holdTabStop = (el: HTMLElement) => {
	el.tabIndex = 0;
	return () => {};
};

// The proxy factory mounts its host from an effect that follows the box, so each runs in a root.
const roots: (() => void)[] = [];
function inEffectRoot<T>(make: () => T): T {
	let made: T | undefined;
	roots.push($effect.root(() => void (made = make())));
	flushSync();
	return made!;
}

// The hidden editing host is contenteditable, so each "is a plugin's own editor holding this?"
// check must exclude it: the focus-element composition, focus placement and offset report.

function attach<T extends HTMLElement>(el: T): T {
	document.body.appendChild(el);
	return el;
}

function box(): HTMLElement {
	return attach(document.createElement('div'));
}

function proxyIn(host: HTMLElement): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
	el.setAttribute('contenteditable', 'true');
	el.tabIndex = -1;
	host.appendChild(el);
	return el;
}

beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => roots.splice(0).forEach((stop) => stop()));

describe('the editing host is not a plugin editable', () => {
	it('is recognized by its attribute and refused by the editable-target guard', () => {
		const el = proxyIn(box());
		expect(isWholeBlockInputProxy(el)).toBe(true);
		expect(isEditableEventTarget(el)).toBe(false);
	});

	it('leaves a real plugin editable answering the guard', () => {
		const textarea = attach(document.createElement('textarea'));
		expect(isWholeBlockInputProxy(textarea)).toBe(false);
		expect(isEditableEventTarget(textarea)).toBe(true);
	});
});

// Without the exclusion the composition reads its own host as the plugin's edit mode and
// withdraws the focus element, so all whole-block key handling dies once the host takes focus.
describe('the composed surface, with the host holding focus', () => {
	// The declared element is deliberately absent, which is the branch that reads activeElement.
	afterEach(() => allowDevWarns(['container-block']));

	it('falls back to the box rather than withdrawing', () => {
		const boxEl = box();
		proxyIn(boxEl).focus();
		const surface = composeWholeBlockFocusSurface(
			() => null,
			() => boxEl,
			() => 'mermaid'
		);
		expect(surface()).toBe(boxEl);
	});
});

describe('holdsWholeBlockFocus', () => {
	it('answers for the declared surface and the host beside it alike', () => {
		const boxEl = box();
		const declared = attach(document.createElement('div'));
		const host = proxyIn(boxEl);

		expect(holdsWholeBlockFocus(declared, host)).toBe(false);
		host.focus();
		expect(holdsWholeBlockFocus(declared, host)).toBe(true);
		declared.tabIndex = 0;
		declared.focus();
		expect(holdsWholeBlockFocus(declared, host)).toBe(true);
	});
});

describe('container shim routing through the host', () => {
	function shim(boxEl: HTMLElement, inputProxy?: WholeBlockInputProxy) {
		return createContainerBlockComponent(
			makeShimDeps([], {
				node: { kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '' } as CstNode,
				getFocusEl: () => boxEl,
				inputProxy
			})
		);
	}

	it('hands both caret entries to the host instead of focusing the declared surface', () => {
		const boxEl = box();
		const landed: HTMLElement[] = [];
		const host = proxyIn(boxEl);
		const proxy: WholeBlockInputProxy = {
			el: () => host,
			focus: (d) => landed.push(d),
			takesKey: () => false
		};

		shim(boxEl, proxy).focus(0);
		shim(boxEl, proxy).focusAtColumn?.(120, 'above');

		expect(landed).toEqual([boxEl, boxEl]);
		expect(document.activeElement).not.toBe(boxEl);
	});

	// Comparing against the declared element alone would report null with focus one sibling away,
	// which every caller reads as "this block does not hold the caret".
	it('reports offset 0 while the host holds focus, and null once focus leaves the block', () => {
		const boxEl = box();
		const host = proxyIn(boxEl);
		const shimApi = shim(boxEl, {
			el: () => host,
			focus: () => host.focus(),
			takesKey: () => false
		});

		host.focus();
		expect(shimApi.getCursorOffset()).toBe(0);

		const elsewhere = attach(document.createElement('div'));
		elsewhere.tabIndex = 0;
		elsewhere.focus();
		expect(shimApi.getCursorOffset()).toBeNull();
	});
});

// Miss-analysis: the only label pin mounted a divider, whose name never changes.
describe('the editing host names its block', () => {
	it('reads the name again on each focus, so a changed name is the one announced', () => {
		const boxEl = box();
		const declared = attach(document.createElement('div'));
		let label = 'Chart';
		const proxy = inEffectRoot(() =>
			createWholeBlockInputProxy({
				getBoxEl: () => boxEl,
				getFocusEl: () => declared,
				isReading: () => false,
				holdTabStop,
				composition: createCompositionTracker(),
				getLabel: () => label,
				mint: () => {}
			})
		);
		expect(proxy.el()?.getAttribute('aria-label')).toBe('Chart');

		label = 'Diagramme';
		proxy.focus(declared);

		expect(document.activeElement).toBe(proxy.el());
		expect(proxy.el()?.getAttribute('aria-label')).toBe('Diagramme');
	});
});

// Miss-analysis: no test typed a character into the host in reading mode.
describe('the editing host in reading mode', () => {
	it('is not editable, and a character that reaches it anyway writes nothing', async () => {
		const editor = makeTopHarness('---\n', { reading: fixtureReading({}, 'reading') });
		const boxEl = box();
		const proxy = inEffectRoot(() =>
			createWholeBlockInputProxy({
				getBoxEl: () => boxEl,
				getFocusEl: () => null,
				isReading: () => true,
				holdTabStop,
				composition: createCompositionTracker(),
				getLabel: () => 'Divider',
				mint: (text) => void editor.actions.insertParagraph(1, text)
			})
		);
		expect(proxy.el()?.getAttribute('contenteditable')).toBe('false');

		proxy
			.el()!
			.dispatchEvent(
				new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', cancelable: true })
			);
		await settleEditor();

		expect(serialize(editor.doc)).toBe('---\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});

// Miss-analysis: the only paste over a clicked divider sat in an exploration spec whose check
// accepted either outcome, so nothing below e2e said a paste into the host writes nothing.
describe('a paste that reaches the editing host', () => {
	it('is refused and mints no paragraph', () => {
		const minted: string[] = [];
		const proxy = inEffectRoot(() =>
			createWholeBlockInputProxy({
				getBoxEl: () => box(),
				getFocusEl: () => null,
				isReading: () => false,
				holdTabStop,
				composition: createCompositionTracker(),
				getLabel: () => 'Divider',
				mint: (text) => void minted.push(text)
			})
		);

		const paste = new InputEvent('beforeinput', {
			inputType: 'insertFromPaste',
			data: 'pasted',
			cancelable: true
		});
		proxy.el()!.dispatchEvent(paste);

		expect(paste.defaultPrevented).toBe(true);
		expect(minted).toEqual([]);
	});
});

// Miss-analysis: every box the host was tested in stayed for the factory's whole life, and a DOM
// block view mounted again hands it a new one.
describe('the editing host follows its box', () => {
	it('moves into a new box, leaving none in the old one', () => {
		const first = box();
		let current = $state(first);
		const proxy = inEffectRoot(() =>
			createWholeBlockInputProxy({
				getBoxEl: () => current,
				getFocusEl: () => null,
				isReading: () => false,
				holdTabStop,
				composition: createCompositionTracker(),
				getLabel: () => 'Diagram',
				mint: () => {}
			})
		);
		expect(first.contains(proxy.el())).toBe(true);

		const second = box();
		current = second;
		flushSync();

		expect(second.contains(proxy.el())).toBe(true);
		expect(first.querySelector(`[${WHOLE_BLOCK_INPUT_ATTR}]`)).toBeNull();
	});
});
