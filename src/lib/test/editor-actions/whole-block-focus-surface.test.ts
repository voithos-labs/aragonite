// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { allowDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';
import {
	composeWholeBlockFocusSurface,
	createContainerBlockComponent
} from '$lib/editor-actions/container-block-component';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';

// A kind whose declared focus element is absent (a render-error state the plugin forgot
// to cover) must degrade to a focusable box, never a no-op that strands the caret.

function box(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

function mermaidNode(): CstNode {
	return { kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '', children: [] } as CstNode;
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('composeWholeBlockFocusSurface', () => {
	it('returns the declared focus element untouched when present', () => {
		const declared = box();
		const boxEl = box();
		const surface = composeWholeBlockFocusSurface(
			() => declared,
			() => boxEl,
			() => 'mermaid'
		);
		expect(surface()).toBe(declared);
		expect(takeDevWarns()).toEqual([]);
	});

	it('falls back to the box when the declared element is null, warning once with the kind', () => {
		const boxEl = box();
		const surface = composeWholeBlockFocusSurface(
			() => null,
			() => boxEl,
			() => 'mermaid'
		);
		expect(surface()).toBe(boxEl);
		expect(surface()).toBe(boxEl);
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('mermaid');
	});

	it('stays null while a plugin-owned editable inside the box holds focus (edit mode)', () => {
		const boxEl = box();
		const textarea = document.createElement('textarea');
		boxEl.appendChild(textarea);
		textarea.focus();
		const surface = composeWholeBlockFocusSurface(
			() => null,
			() => boxEl,
			() => 'mermaid'
		);
		expect(surface()).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});

	it('returns null when neither the declared element nor the box exists', () => {
		const surface = composeWholeBlockFocusSurface(
			() => null,
			() => undefined,
			() => 'mermaid'
		);
		expect(surface()).toBeNull();
	});
});

describe('container shim through a composed fallback surface', () => {
	// Every shim here composes the fallback the describe above pins; the shim's focus is the subject.
	afterEach(() => allowDevWarns(['container-block']));

	function shim(boxEl: HTMLElement, declared: HTMLElement | null = null) {
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
				return mermaidNode();
			},
			getFocusEl: composeWholeBlockFocusSurface(
				() => declared,
				() => boxEl,
				() => 'mermaid'
			)
		});
	}

	it('focus() lands DOM focus on the box, minting tabindex for a plain div', () => {
		const boxEl = box();
		shim(boxEl).focus(0);
		expect(document.activeElement).toBe(boxEl);
		expect(boxEl.tabIndex).toBe(-1);
	});

	it('focus() keeps an explicit tabindex the box already carries', () => {
		const boxEl = box();
		boxEl.setAttribute('tabindex', '0');
		shim(boxEl).focus(0);
		expect(document.activeElement).toBe(boxEl);
		expect(boxEl.getAttribute('tabindex')).toBe('0');
	});

	// An empty diagram declares its edit textarea as the focus surface: already in the tab
	// order, so minting -1 took it out. The arm above guarded only an EXPLICIT tabindex.
	it('focus() leaves an already-focusable surface’s tab order alone', () => {
		const boxEl = box();
		const textarea = document.createElement('textarea');
		boxEl.appendChild(textarea);
		shim(boxEl, textarea).focus(0);
		expect(document.activeElement).toBe(textarea);
		expect(textarea.hasAttribute('tabindex')).toBe(false);
	});

	it('focusAtColumn() (vertical entry) also lands on the box', () => {
		const boxEl = box();
		shim(boxEl).focusAtColumn?.(120, 'above');
		expect(document.activeElement).toBe(boxEl);
	});

	it('getCursorOffset() agrees with the fallback: 0 while the box holds focus, null after', () => {
		const boxEl = box();
		const c = shim(boxEl);
		c.focus(0);
		expect(c.getCursorOffset()).toBe(0);
		const other = box();
		other.tabIndex = 0;
		other.focus();
		expect(c.getCursorOffset()).toBeNull();
	});
});
