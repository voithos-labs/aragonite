// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import {
	composeWholeBlockFocusSurface,
	createContainerBlockComponent
} from '$lib/editor-actions/container-block-component';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

// The class guard behind whole-block focus: a kind whose declared focus element
// is absent (a render-error/loading state the plugin forgot to cover) must
// degrade to a focusable box, never a silent no-op that strands the caret.

function box(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

function mermaidNode(): CstNode {
	return { kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '', children: [] } as CstNode;
}

beforeEach(() => {
	vi.mocked(devWarn).mockClear();
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
		expect(devWarn).not.toHaveBeenCalled();
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
		expect(devWarn).toHaveBeenCalledTimes(1);
		expect(vi.mocked(devWarn).mock.calls[0][1]).toContain('mermaid');
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
		expect(devWarn).not.toHaveBeenCalled();
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
	function shim(boxEl: HTMLElement) {
		return createContainerBlockComponent({
			get innerBlockRefs() {
				return [];
			},
			get nodeChildrenLength() {
				return 0;
			},
			get node() {
				return mermaidNode();
			},
			getFocusEl: composeWholeBlockFocusSurface(
				() => null,
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
