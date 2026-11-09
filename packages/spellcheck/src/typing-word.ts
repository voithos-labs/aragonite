/**
 * The word the caret is typing in stays plain until the caret leaves it, so a half-typed word
 * never flickers red. Positions are document byte offsets.
 */

import type { Block, Editor } from '@voithos-labs/aragonite/plugin';
import { spanAt } from './words';

type Span = { readonly from: number; readonly to: number };

export interface TypingWord {
	/** A keystroke left the caret at `caret`, or left no caret; its block paints next. */
	typed(caret: number | null): void;
	/** `block` painted with these words: the keystroke's word is held if the block holds its caret. */
	painted(block: Pick<Block, 'from' | 'to'>, spans: readonly Span[]): void;
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
	let keystroke: number | null = null;
	const release = (): Span | null => {
		const held = word;
		word = keystroke = null;
		return held;
	};
	return {
		typed(caret) {
			word = null;
			keystroke = caret;
		},
		painted(block, spans) {
			if (keystroke === null || keystroke < block.from || keystroke > block.to) return;
			word = spanAt(spans, keystroke);
			keystroke = null;
		},
		moved(caret) {
			// The keystroke's own caret, reported before its block paints.
			if (keystroke !== null && caret === keystroke) return null;
			keystroke = null;
			if (!word) return null;
			if (caret !== null && caret >= word.from && caret <= word.to) return null;
			return release();
		},
		release,
		holds: (from) => word?.from === from
	};
}

/** Feeds `typing` from the editor's keystrokes and caret moves, and paints a word again once
 *  it's let go. A keystroke lands before the editor paints its block, so the word never shows. */
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
		if (event.op === 'input') typing.typed(caret());
		else show(typing.release());
	});
	editor.on('selectionChange', () => show(typing.moved(caret())));
	editor.on('sourceSwap', () => void typing.release());
}
