/**
 * Which elements dispatch a container's kind chords, marked with the kind so `claimsChord` finds
 * every container a key bubbles through. A container factory marks its box, where the plugin
 * contract binds `handleKeydown`; a block binding its own handler uses `listenForContainerChords`.
 */

import { on } from 'svelte/events';
import type { AnyBlockKind } from '../core/nodes';

const CONTAINER_CHORDS_ATTR = 'data-container-chords';
const CONTAINER_CHORDS_SELECTOR = '[data-container-chords]';

/** Marks the element `getEl` returns for as long as the calling component lives. */
export function markContainerChords(
	getEl: () => HTMLElement | null | undefined,
	getKind: () => AnyBlockKind
): void {
	$effect(() => {
		const el = getEl();
		if (!el) return;
		el.setAttribute(CONTAINER_CHORDS_ATTR, getKind());
		return () => el.removeAttribute(CONTAINER_CHORDS_ATTR);
	});
}

/** Installs a container's keydown on `el` and marks it; returns the teardown. */
export function listenForContainerChords(
	el: HTMLElement,
	kind: AnyBlockKind,
	handler: (e: KeyboardEvent) => void
): () => void {
	el.setAttribute(CONTAINER_CHORDS_ATTR, kind);
	const off = on(el, 'keydown', handler);
	return () => {
		off();
		el.removeAttribute(CONTAINER_CHORDS_ATTR);
	};
}

/** The kinds of the containers whose keydown a key at `el` reaches, nearest first. */
export function containerChordKinds(el: Element): AnyBlockKind[] {
	const kinds: AnyBlockKind[] = [];
	for (
		let at = el.closest(CONTAINER_CHORDS_SELECTOR);
		at;
		at = at.parentElement?.closest(CONTAINER_CHORDS_SELECTOR) ?? null
	) {
		kinds.push(at.getAttribute(CONTAINER_CHORDS_ATTR) as AnyBlockKind);
	}
	return kinds;
}

/** The kind an element is marked with, or null for an unmarked one. */
export function containerChordKindOf(el: EventTarget | null): string | null {
	return el instanceof Element ? el.getAttribute(CONTAINER_CHORDS_ATTR) : null;
}
