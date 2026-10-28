/**
 * The input of an empty element that only holds a caret (the gap caret, a whole-block block's
 * hidden host): typed or composed text goes to `insert`, a new paragraph, and the element goes back
 * to empty. Every other input is refused at `beforeinput`.
 */

import { readInput } from '../browser/input';
import type { CompositionOwner, CompositionTracker } from '../browser/composition';
import { isCharacterKey } from '../schema/keybindings';

export interface CaretHostInput {
	onBeforeInput(event: InputEvent): void;
	onCompositionStart(): void;
	onCompositionEnd(): void;
	/** Whether `event` is a plain key that ended a composition the browser dropped here, so it's spent
	 *  (a character joined the text); Enter runs `openAfter` once the composed paragraph lands. */
	takesKey(event: KeyboardEvent, openAfter: () => unknown): boolean;
}

export function createCaretHostInput(
	getHost: () => HTMLElement | null | undefined,
	insert: (text: string) => unknown,
	composition: CompositionTracker
): CaretHostInput {
	let minted: { at: Event; landed: Promise<unknown> } | null = null;

	// Nothing serializes the host, so whatever the IME left in it belongs to the new paragraph.
	function takeHostText(): string {
		const host = getHost();
		const text = host?.textContent ?? '';
		if (host) host.textContent = '';
		return text;
	}

	const owner: CompositionOwner = {
		get el() {
			return getHost() ?? null;
		},
		dropped(signal) {
			// The beforeinput's own step below takes the left text with the typed text, as one insert.
			if (signal.type === 'beforeinput') return;
			const text = takeHostText();
			if (!text) return;
			const typed = signal instanceof KeyboardEvent && typesCharacter(signal) ? signal.key : '';
			minted = { at: signal, landed: Promise.resolve(insert(text + typed)) };
		}
	};

	return {
		onBeforeInput(event) {
			const host = getHost();
			if (host) composition.adopt(event, owner);
			// The browser owns the host between compositionstart and compositionend, as it does
			// everywhere in the editor: refusing here would swallow the composition.
			if (composition.openIn(host)) return;
			event.preventDefault();
			const typed = readInput(event).kind === 'insert' ? (event.data ?? '') : '';
			const text = takeHostText() + typed;
			if (text) insert(text);
		},
		onCompositionStart() {
			if (getHost()) composition.start(owner);
		},
		onCompositionEnd() {
			composition.end(owner);
			const text = takeHostText();
			if (text) insert(text);
		},
		takesKey(event, openAfter) {
			if (!minted || minted.at !== event || event.ctrlKey || event.metaKey || event.altKey) {
				return false;
			}
			event.preventDefault();
			if (event.key === 'Enter') void minted.landed.then(openAfter);
			return true;
		}
	};
}

function typesCharacter(e: KeyboardEvent): boolean {
	return isCharacterKey(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
}
