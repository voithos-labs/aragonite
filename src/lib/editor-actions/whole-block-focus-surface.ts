/**
 * The focus surface of a block that IS its own focus target, and the hidden editing host beside
 * it. Such a block has no editing surface of its own, so `beforeinput` and `compositionend` —
 * the only doors AltGr productions and IME composition arrive through — fire nowhere. The proxy
 * is that host. It mounts in the block's BOX, never in the declared focus element, which a
 * render swap replaces.
 */

import { onMount } from 'svelte';
import { WHOLE_BLOCK_INPUT_LABEL } from '../a11y-strings';
import { devWarn } from '../dev-warn';

// ── Editable-target guards ───────────────────────────────────────────────────

/** The hidden host looks exactly like a plugin's own editable; this is what tells them apart. */
export const WHOLE_BLOCK_INPUT_ATTR = 'data-whole-block-input';

export function isWholeBlockInputProxy(target: EventTarget | null): boolean {
	return target instanceof Element && target.hasAttribute(WHOLE_BLOCK_INPUT_ATTR);
}

/**
 * A key originating in a plugin's own text-editing surface belongs to that surface, never the
 * whole-block affordances: Backspace inside an edit textarea edits text. The hidden host is
 * excluded here rather than at each gate, so a later reader cannot forget it.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (isWholeBlockInputProxy(target)) return false;
	const tag = target.tagName;
	return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

// ── Tab order ────────────────────────────────────────────────────────────────

/**
 * The hidden host is the block's ONE tab stop, so a declared surface that is not itself an
 * editing host leaves the tab order (editor.md § 8). Applied on every read rather than once at
 * mount: a kind's declared element is whatever its current render state supplies, and the state
 * that appears after mount would otherwise keep its stop. Inverse of `focusWholeBlockEl`, which
 * only ever MINTS focusability on a box that has none.
 */
export function demoteDeclaredFromTabOrder(declared: HTMLElement | null): HTMLElement | null {
	if (declared && declared.tabIndex >= 0 && !isEditableEventTarget(declared)) {
		declared.tabIndex = -1;
	}
	return declared;
}

/**
 * The class guard behind `getFocusEl`: an absent declared element degrades to the
 * focusable box, never a silent no-op that strands the caret. The one legitimate null
 * survives — a plugin-owned editable inside the box holding focus.
 */
export function composeWholeBlockFocusSurface(
	getFocusEl: () => HTMLElement | null | undefined,
	getBoxEl: () => HTMLElement | null | undefined,
	getKind: () => string
): () => HTMLElement | null {
	let warned = false;
	return () => {
		const declared = getFocusEl();
		if (declared) return demoteDeclaredFromTabOrder(declared);
		const box = getBoxEl();
		if (!box) return null;
		const active = document.activeElement;
		if (isEditableEventTarget(active) && box.contains(active)) return null;
		if (!warned) {
			warned = true;
			devWarn(
				'container-block',
				`whole-block kind "${getKind()}" supplied no focus element for this state; falling back to the box`
			);
		}
		return box;
	};
}

// The degraded path's own policy, and the inverse of the demotion above: the fallback box is a
// plain div, focusable only once a tabindex is minted. A surface already focusable keeps whatever
// it has — this door only ever adds reachability, never removes it.
export function focusWholeBlockEl(el: HTMLElement): void {
	if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
	el.focus();
}

/** Whole-block focus sits on the declared surface OR on the hidden host beside it. */
export function holdsWholeBlockFocus(
	declared: HTMLElement | null | undefined,
	proxy: HTMLElement | null | undefined
): boolean {
	const active = document.activeElement;
	return !!(declared?.contains(active) || (proxy && proxy === active));
}

// ── Hidden editing host ──────────────────────────────────────────────────────

export interface WholeBlockInputProxyDeps {
	/** The chrome box: stable across the render swaps that replace a declared focus element. */
	getBoxEl: () => HTMLElement | null | undefined;
	/** The kind's declared surface. An editable one is the plugin's own caret host and keeps
	 *  focus for itself. */
	getFocusEl: () => HTMLElement | null | undefined;
	isReading: () => boolean;
	/** Commit the bytes the host produced — the keydown tail's mint, through another door. */
	mint: (text: string) => void;
}

export interface WholeBlockInputProxy {
	/** The mounted host, or null while the block has no box. */
	el(): HTMLElement | null;
	/** Land DOM focus for a whole-block entry, degrading to `declared` when the plugin owns
	 *  the caret or the host has not mounted. */
	focus(declared: HTMLElement): void;
}

export function createWholeBlockInputProxy(deps: WholeBlockInputProxyDeps): WholeBlockInputProxy {
	let proxy: HTMLElement | null = null;
	let composing = false;

	/** Every read of the declared surface inside the proxy goes through the demotion, so a kind
	 *  supplying its own `getFocusEl` (no composed surface) is held to the rule too. */
	const declaredSurface = (): HTMLElement | null =>
		demoteDeclaredFromTabOrder(deps.getFocusEl() ?? null);

	function mint(text: string): void {
		if (!deps.isReading()) deps.mint(text);
	}

	function onBeforeInput(event: InputEvent): void {
		// The browser owns the host between compositionstart and compositionend (the editor's
		// standing IME stance) — refusing here swallows the composition.
		if (composing) return;
		event.preventDefault();
		if (event.inputType === 'insertText' && event.data) mint(event.data);
	}

	function onCompositionEnd(): void {
		composing = false;
		const composed = proxy?.textContent ?? '';
		// A caret host, never a surface a serializer reads: whatever the IME left belongs to the
		// minted paragraph, and the host goes back to empty either way.
		if (proxy) proxy.textContent = '';
		if (composed) mint(composed);
	}

	// A pointer or a Tab lands natively on the kind's own surface, where no beforeinput fires;
	// without this hand-off the first character after a click is keydown-minted again.
	function onFocusIn(event: FocusEvent): void {
		// Read before the identity test, so an arrival ANYWHERE in the box (the host's own included)
		// re-applies the demotion to whatever surface the current render state supplies — which is
		// what puts it out of the tab order before the next press, not after it.
		if (!proxy || event.target !== declaredSurface()) return;
		if (isEditableEventTarget(event.target)) return;
		// The host's own Shift+Tab lands here on its way out; bouncing it back would trap focus
		// in the block. Every other arrival is passed on — a toolbar button included, or the
		// click after one leaves the declared surface holding focus and drops IME again.
		if (event.relatedTarget === proxy) return;
		focusProxy();
	}

	function focusProxy(): void {
		if (!proxy) return;
		// Read per focus, not per mount: reading mode writes no bytes, so its host is inert.
		proxy.setAttribute('contenteditable', deps.isReading() ? 'false' : 'true');
		proxy.focus();
	}

	onMount(() => {
		const box = deps.getBoxEl();
		if (!box) return;
		proxy = document.createElement('div');
		proxy.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
		proxy.className = 'whole-block-input';
		proxy.setAttribute('contenteditable', deps.isReading() ? 'false' : 'true');
		proxy.setAttribute('role', 'textbox');
		proxy.setAttribute('aria-label', WHOLE_BLOCK_INPUT_LABEL);
		proxy.spellcheck = false;
		// The block's tab stop, because focus belongs here: a declared surface left in the tab
		// order is a second stop the backward tab parks on, where no input door exists.
		proxy.tabIndex = 0;
		declaredSurface();
		proxy.addEventListener('beforeinput', onBeforeInput as EventListener);
		proxy.addEventListener('compositionstart', () => (composing = true));
		proxy.addEventListener('compositionend', onCompositionEnd);
		box.addEventListener('focusin', onFocusIn);
		box.appendChild(proxy);
		return () => {
			box.removeEventListener('focusin', onFocusIn);
			proxy?.remove();
			proxy = null;
		};
	});

	return {
		el: () => proxy,
		focus(declared: HTMLElement) {
			if (!proxy || isEditableEventTarget(declared)) {
				focusWholeBlockEl(declared);
				return;
			}
			demoteDeclaredFromTabOrder(declared);
			focusProxy();
		}
	};
}
