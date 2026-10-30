/**
 * Which elements dispatch a container's kind chords, marked with the kind so `claimsChord` finds
 * every container a key bubbles through. A container factory marks its box, where the plugin
 * contract binds `handleKeydown`; a block binding its own handler uses `listenForContainerChords`.
 */

import { untrack } from 'svelte';
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
		// Untracked: a block's kind never changes, while its node is copied by every edit inside it.
		return el ? mark(el, untrack(getKind)) : undefined;
	});
}

/** Installs a container's keydown on `el` and marks it; returns the teardown. */
export function listenForContainerChords(
	el: HTMLElement,
	kind: AnyBlockKind,
	handler: (e: KeyboardEvent) => void
): () => void {
	const unmark = mark(el, kind);
	const off = on(el, 'keydown', handler);
	return () => {
		off();
		unmark();
	};
}

// Counted, since a factory's box and a block's own listener can mark one element: the first
// owner to let go must not strip the mark the other still relies on.
const markHolders = new WeakMap<Element, number>();

function mark(el: HTMLElement, kind: AnyBlockKind): () => void {
	el.setAttribute(CONTAINER_CHORDS_ATTR, kind);
	markHolders.set(el, (markHolders.get(el) ?? 0) + 1);
	return () => {
		const left = (markHolders.get(el) ?? 1) - 1;
		markHolders.set(el, left);
		if (left === 0) el.removeAttribute(CONTAINER_CHORDS_ATTR);
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
