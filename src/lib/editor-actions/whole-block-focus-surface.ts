/**
 * The focus element of a block that is focused as a whole, and the hidden editing host beside
 * it. Such a block has no editable element of its own, so `beforeinput` and `compositionend`,
 * the only events AltGr characters and IME composition arrive through, fire nowhere. The
 * proxy is that host. It mounts in the block's box, never in the declared focus element,
 * which a render swap replaces.
 */

import { onMount } from 'svelte';
import { devWarn } from '../dev-warn';

// ── Editable-target guards ───────────────────────────────────────────────────

/** The hidden host looks exactly like a plugin's own editable; this is what tells them apart. */
export const WHOLE_BLOCK_INPUT_ATTR = 'data-whole-block-input';

export function isWholeBlockInputProxy(target: EventTarget | null): boolean {
	return target instanceof Element && target.hasAttribute(WHOLE_BLOCK_INPUT_ATTR);
}

/**
 * A key pressed in a plugin's own text editor belongs to that editor, never to the whole-block
 * key handling: Backspace inside an edit textarea edits text. The hidden host is excluded
 * here rather than at each check, so a later caller cannot forget it.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (isWholeBlockInputProxy(target)) return false;
	const tag = target.tagName;
	return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

// ── Tab order ────────────────────────────────────────────────────────────────

/**
 * The hidden host is the block's one tab stop, so a declared element that is not itself an
 * editor leaves the tab order (editor.md § 8). Applied on every read, since a render state
 * that appears after mount supplies a new element.
 */
export function demoteDeclaredFromTabOrder(declared: HTMLElement | null): HTMLElement | null {
	if (declared && declared.tabIndex >= 0 && !isEditableEventTarget(declared)) {
		declared.tabIndex = -1;
	}
	return declared;
}

/**
 * The fallback behind `getFocusEl`: an absent declared element degrades to the focusable
 * box, never a silent no-op that strands the caret. The one legitimate null survives: a
 * plugin-owned editable inside the box holding focus.
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

// The fallback's own rule, and the inverse of the demotion above: the fallback box is a plain
// div, focusable only once it gets a tabindex. An element already focusable keeps what it
// has; this only ever adds reachability, never removes it.
export function focusWholeBlockEl(el: HTMLElement): void {
	if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
	el.focus();
}

/** Whole-block focus sits on the declared element or on the hidden host beside it. */
export function holdsWholeBlockFocus(
	declared: HTMLElement | null | undefined,
	proxy: HTMLElement | null | undefined
): boolean {
	const active = document.activeElement;
	return !!(declared?.contains(active) || (proxy && proxy === active));
}

// ── Hidden editing host ──────────────────────────────────────────────────────

export interface WholeBlockInputProxyDeps {
	/** The block's box: stable across the render swaps that replace a declared focus element. */
	getBoxEl: () => HTMLElement | null | undefined;
	/** The kind's declared focus element. An editable one is the plugin's own caret host and
	 *  keeps focus for itself. */
	getFocusEl: () => HTMLElement | null | undefined;
	isReading: () => boolean;
	/** The block's accessible name: the host is the block's tab stop, so it names the block. */
	getLabel: () => string;
	/** Commit the bytes the host produced: the same paragraph the keydown path creates. */
	mint: (text: string) => void;
}

export interface WholeBlockInputProxy {
	/** The mounted host, or null while the block has no box. */
	el(): HTMLElement | null;
	/** Put DOM focus for a whole-block entry, falling back to `declared` when the plugin owns
	 *  the caret or the host has not mounted. */
	focus(declared: HTMLElement): void;
}

export function createWholeBlockInputProxy(deps: WholeBlockInputProxyDeps): WholeBlockInputProxy {
	let proxy: HTMLElement | null = null;
	let composing = false;

	/** Every read of the declared element inside the proxy goes through the demotion, so a kind
	 *  supplying its own `getFocusEl` (without the composed fallback) is held to the rule too. */
	const declaredSurface = (): HTMLElement | null =>
		demoteDeclaredFromTabOrder(deps.getFocusEl() ?? null);

	function onBeforeInput(event: InputEvent): void {
		// The browser owns the host between compositionstart and compositionend (the editor's
		// standing IME rule); refusing here swallows the composition.
		if (composing) return;
		event.preventDefault();
		if (event.inputType === 'insertText' && event.data) deps.mint(event.data);
	}

	function onCompositionEnd(): void {
		composing = false;
		const composed = proxy?.textContent ?? '';
		// A caret host, never something a serializer reads: whatever the IME left belongs to the
		// new paragraph, and the host goes back to empty either way.
		if (proxy) proxy.textContent = '';
		if (composed) deps.mint(composed);
	}

	// A click or a Tab lands natively on the kind's own element, where no beforeinput fires;
	// without this hand-off the first character after a click goes through keydown again.
	function onFocusIn(event: FocusEvent): void {
		// A Tab lands on the host without passing `focusProxy`, so the name is refreshed here too.
		if (proxy && event.target === proxy) syncProxyState();
		// Read before the identity test, so focus arriving anywhere in the box (the host's own
		// included) re-applies the demotion to whatever element the current render state
		// supplies, which takes it out of the tab order before the next keypress, not after.
		if (!proxy || event.target !== declaredSurface()) return;
		if (isEditableEventTarget(event.target)) return;
		// The host's own Shift+Tab lands here on its way out; bouncing it back would trap focus
		// in the block. Every other arrival is passed on, a toolbar button included, or the click
		// after one leaves the declared element holding focus and drops IME again.
		if (event.relatedTarget === proxy) return;
		focusProxy();
	}

	function focusProxy(): void {
		if (!proxy) return;
		syncProxyState();
		proxy.focus();
	}

	// Read per focus, not per mount: reading mode makes the host inert, and a kind's name can
	// change while the block stays mounted.
	function syncProxyState(): void {
		if (!proxy) return;
		proxy.setAttribute('contenteditable', deps.isReading() ? 'false' : 'true');
		proxy.setAttribute('aria-label', deps.getLabel());
	}

	onMount(() => {
		const box = deps.getBoxEl();
		if (!box) return;
		proxy = document.createElement('div');
		proxy.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
		proxy.className = 'whole-block-input';
		proxy.setAttribute('role', 'textbox');
		syncProxyState();
		proxy.spellcheck = false;
		// The block's tab stop, because focus belongs here: a declared element left in the tab
		// order is a second stop Shift+Tab lands on, where no input can arrive.
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
