/**
 * The input of an empty element that only holds a caret (the gap caret, a whole-block block's
 * hidden host): typed or composed text goes to `insert`, a new paragraph, and the element goes back
 * to empty. Every other input is refused at `beforeinput`.
 */

import { opensComposition, reportDroppedComposition } from './dropped-composition';
import { readInput } from '../browser/input';

export interface CaretHostInput {
	onBeforeInput(event: InputEvent): void;
	onCompositionStart(): void;
	onCompositionEnd(): void;
}

export function createCaretHostInput(
	getHost: () => HTMLElement | null | undefined,
	insert: (text: string) => void
): CaretHostInput {
	let composing = false;

	// Nothing serializes the host, so whatever the IME left in it belongs to the new paragraph.
	function takeHostText(): string {
		const host = getHost();
		const text = host?.textContent ?? '';
		if (host) host.textContent = '';
		return text;
	}

	function endComposition(): void {
		composing = false;
		const text = takeHostText();
		if (text) insert(text);
	}

	return {
		onBeforeInput(event) {
			if (opensComposition(event, composing)) composing = true;
			// The browser owns the host between compositionstart and compositionend, as it does
			// everywhere in the editor: refusing here would swallow the composition.
			if (composing && !reportDroppedComposition(event, composing)) return;
			composing = false;
			event.preventDefault();
			const typed = readInput(event).kind === 'insert' ? (event.data ?? '') : '';
			const text = takeHostText() + typed;
			if (text) insert(text);
		},
		onCompositionStart() {
			if (reportDroppedComposition('compositionstart', composing)) endComposition();
			composing = true;
		},
		onCompositionEnd: endComposition
	};
}
