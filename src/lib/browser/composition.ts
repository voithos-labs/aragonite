/**
 * Whether the IME owns a key or an input, and the editor's one record of the composition in
 * progress. The tracker asks at every key, input and composition start in the editor's root
 * whether the browser dropped the composition without a `compositionend`, so no element hosting
 * one can miss a signal; the element only opens its composition and commits it.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { readInput } from './input';

// ── Who owns a key ──────────────────────────────────────────────────────────

/** Whether `e` is the IME's, and so never a command: inside a composition, or the key that opens
 *  or feeds one, which Chromium and WebKit send with `isComposing: false` (`Process`, code 229). */
export function imeOwnsKey(e: Pick<KeyboardEvent, 'isComposing' | 'key' | 'keyCode'>): boolean {
	return e.isComposing || e.key === 'Process' || e.keyCode === 229;
}

/** Whether the browser sent `e` inside a composition. */
export function imeOwnsInput(e: Pick<InputEvent, 'isComposing'>): boolean {
	return e.isComposing;
}

// ── The composition in progress ─────────────────────────────────────────────

/** What hosts a composition: a block's text, or the empty element the gap caret and a block
 *  focused whole type into. One per host, so a host whose element went away still ends its own. */
export interface CompositionOwner {
	/** The host's element now; null once it unmounted. */
	readonly el: HTMLElement | null;
	/** Commits what the IME left, once the browser dropped the composition; `signal` is the event
	 *  that showed it. */
	dropped(signal: Event): void;
}

export interface CompositionTracker {
	/** Listens on the editor's root for the signals a dropped composition shows at. */
	install(root: HTMLElement): () => void;
	/** A composition started in `owner`'s element; null when a range across blocks claimed it, and
	 *  the block its removal leaves the caret in adopts it at the first run. */
	start(owner: CompositionOwner | null): void;
	/** Opens the composition at `owner` for a composed run when it holds none; true when it did. */
	adopt(e: InputEvent, owner: CompositionOwner): boolean;
	/** `compositionend` at `owner`; false when it held nothing and no start was claimed. */
	end(owner: CompositionOwner): boolean;
	/** Whether any composition is open, a claimed start included. */
	live(): boolean;
	/** Whether `el` holds the open composition. */
	openIn(el: HTMLElement | null | undefined): boolean;
	/** Whether a dropped composition ended at `e`, so a commit `e` would run has already run. */
	endedBy(e: Event): boolean;
	/** Calls `listener` each time a composition opens, moves or closes. */
	subscribe(listener: () => void): () => void;
}

export function createCompositionTracker(): CompositionTracker {
	let live = false;
	let owner: CompositionOwner | null = null;
	let endedAt: Event | null = null;
	const listeners = new Set<() => void>();

	function set(nextLive: boolean, nextOwner: CompositionOwner | null): void {
		if (live === nextLive && owner === nextOwner) return;
		live = nextLive;
		owner = nextOwner;
		listeners.forEach((listener) => listener());
	}

	// An owner whose element left the document has nothing to commit, so it goes quietly.
	function drop(signal: Event): void {
		const was = owner;
		endedAt = signal;
		set(false, null);
		if (!was?.el?.isConnected) return;
		devWarn(
			'composition',
			`a ${signal.type} arrived outside the open composition with no compositionend, so the browser dropped it; the editor ended it here`
		);
		was.dropped(signal);
	}

	function hear(signal: Event): void {
		if (live && sentOutsideComposition(signal)) drop(signal);
		if (signal.type === 'compositionstart') set(true, null);
	}

	return {
		install(root) {
			const listening = new AbortController();
			const capture = { capture: true, signal: listening.signal };
			for (const type of ['keydown', 'beforeinput', 'input', 'compositionstart']) {
				root.addEventListener(type, hear, capture);
			}
			// Bubbling, so it runs after an owner's own: a composition outside every owner (the find
			// field, a plugin's input) closes here.
			root.addEventListener('compositionend', () => owner === null && set(false, null), {
				signal: listening.signal
			});
			return () => listening.abort();
		},
		start: (next) => set(true, next),
		adopt(e, next) {
			if (owner === next || !imeOwnsInput(e)) return false;
			const read = readInput(e);
			if (read.kind !== 'compose' || read.final) return false;
			if (owner) drop(e);
			set(true, next);
			return true;
		},
		end(at) {
			const paired = live && (owner === null || owner === at);
			set(false, null);
			return paired;
		},
		live: () => live,
		openIn: (el) => !!el && owner?.el === el,
		endedBy: (e) => endedAt === e,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

/** Whether `signal`, heard while a composition is open, shows the browser ended it unannounced. */
function sentOutsideComposition(signal: Event): boolean {
	if (signal.type === 'compositionstart') return true;
	if (signal instanceof KeyboardEvent) return !imeOwnsKey(signal);
	if (!(signal instanceof InputEvent) || imeOwnsInput(signal)) return false;
	// A key's own beforeinput and input say `isComposing: false` even inside a live composition, and
	// its keydown carries the real state, so only typed text proves the composition over.
	return readInput(signal).kind === 'insert';
}
