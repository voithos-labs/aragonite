/**
 * The word the caret is typing in stays plain until the caret leaves it, so a half-typed word
 * never flickers red. Positions are document byte offsets.
 */

export interface TypingWord {
	/** Text was typed, leaving the caret inside `word` (its bytes), or inside no word. */
	typed(word: { from: number; to: number } | null): void;
	/** The caret moved to `caret`, or the selection became a range or went away (null). True when
	 *  that let the typed word go, so its mark can show. */
	moved(caret: number | null): boolean;
	/** Any other edit, or another document; true when a word was held. */
	release(): boolean;
	/** Whether the word starting at `from` is the one being typed. */
	holds(from: number): boolean;
}

export function createTypingWord(): TypingWord {
	let word: { from: number; to: number } | null = null;
	const release = (): boolean => {
		const held = word !== null;
		word = null;
		return held;
	};
	return {
		typed(next) {
			word = next;
		},
		moved(caret) {
			if (!word) return false;
			if (caret !== null && caret >= word.from && caret <= word.to) return false;
			return release();
		},
		release,
		holds: (from) => word?.from === from
	};
}
