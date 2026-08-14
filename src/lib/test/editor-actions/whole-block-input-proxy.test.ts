// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import {
	WHOLE_BLOCK_INPUT_ATTR,
	composeWholeBlockFocusSurface,
	holdsWholeBlockFocus,
	isEditableEventTarget,
	isWholeBlockInputProxy,
	type WholeBlockInputProxy
} from '$lib/editor-actions/whole-block-focus-surface';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';

// The hidden editing host is contenteditable, so every gate that asks "is a plugin's own
// editable surface holding this?" would answer yes about the editor's own chrome. These are the
// three seams that would then misroute: the focus-surface composition, the shim's focus landing,
// and the shim's cursor-offset report.

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
// withdraws the surface, so every whole-block affordance dies the moment the host takes focus.
describe('the composed surface, with the host holding focus', () => {
	// The declared element is deliberately absent, which is the arm that consults activeElement.
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
		return createContainerBlockComponent({
			selection: createSelectionState(),
			get innerBlockRefs() {
				return [];
			},
			refSlots: refSlotsOver([]),
			get nodeChildrenLength() {
				return 0;
			},
			get node() {
				return { kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '' } as CstNode;
			},
			getFocusEl: () => boxEl,
			inputProxy
		});
	}

	it('hands both caret entries to the host instead of focusing the declared surface', () => {
		const boxEl = box();
		const landed: HTMLElement[] = [];
		const host = proxyIn(boxEl);
		const proxy: WholeBlockInputProxy = { el: () => host, focus: (d) => landed.push(d) };

		shim(boxEl, proxy).focus(0);
		shim(boxEl, proxy).focusAtColumn?.(120, 'above');

		expect(landed).toEqual([boxEl, boxEl]);
		expect(document.activeElement).not.toBe(boxEl);
	});

	// Identity against the declared element reported null with focus one sibling away, which
	// reads to every caller as "this block does not hold the caret".
	it('reports offset 0 while the host holds focus, and null once focus leaves the block', () => {
		const boxEl = box();
		const host = proxyIn(boxEl);
		const shimApi = shim(boxEl, { el: () => host, focus: () => host.focus() });

		host.focus();
		expect(shimApi.getCursorOffset()).toBe(0);

		const elsewhere = attach(document.createElement('div'));
		elsewhere.tabIndex = 0;
		elsewhere.focus();
		expect(shimApi.getCursorOffset()).toBeNull();
	});
});
