/**
 * The word the caret is typing in stays plain until the caret leaves it, so a half-typed word
 * never flickers red. Positions are document byte offsets.
 */

import type { Editor } from '@voithos-labs/aragonite/plugin';
import { wordAt } from './misspelling';

type Span = { readonly from: number; readonly to: number };

export interface TypingWord {
	/** Text was typed, leaving the caret inside `word` (its bytes), or inside no word. */
	typed(word: Span | null): void;
	/** The caret moved to `caret`, or the selection became a range or went away (null). Hands
	 *  back the word that let go, so its mark can show. */
	moved(caret: number | null): Span | null;
	/** Any other edit, or another document; hands back the word that was held. */
	release(): Span | null;
	/** Whether the word starting at `from` is the one being typed. */
	holds(from: number): boolean;
}

export function createTypingWord(): TypingWord {
	let word: Span | null = null;
	const release = (): Span | null => {
		const held = word;
		word = null;
		return held;
	};
	return {
		typed(next) {
			word = next;
		},
		moved(caret) {
			if (!word) return null;
			if (caret !== null && caret >= word.from && caret <= word.to) return null;
			return release();
		},
		release,
		holds: (from) => word?.from === from
	};
}

/** Feeds `typing` from the editor's keystrokes and caret moves, and paints a word again once
 *  it's let go. The edit fires before the editor paints its new bytes, so the word never shows. */
export function followTyping(editor: Editor, typing: TypingWord): void {
	const caret = (): number | null => {
		const range = editor.selectedRange();
		return range && range.from === range.to ? range.from : null;
	};
	const show = (word: Span | null): void => {
		const block = word && editor.blockAt(word.from);
		if (block) editor.repaint([block]);
	};
	editor.on('edit', (event) => {
		if (event.op !== 'input') return show(typing.release());
		const at = caret();
		typing.typed(at === null ? null : wordAt(editor, at));
	});
	editor.on('selectionChange', () => show(typing.moved(caret())));
	editor.on('sourceSwap', () => void typing.release());
}
