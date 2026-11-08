/**
 * What the spell check asks about words. The editor never decides a spelling itself and never
 * stores a word: a dictionary answers, and keeps what a user adds only if it can.
 */

/** A dictionary the spell check asks one word at a time. Each method may answer at once or with a
 *  promise; a word is asked once and its answer kept, until `watch` says the words changed. */
export interface Dictionary {
	/** Whether `word` is spelled right. Asked with the word as written, capitals included. */
	check(word: string): boolean | Promise<boolean>;
	/** Replacements for a misspelled word, best first, empty for none. Asked only when a menu
	 *  opens over the word. */
	suggest(word: string): readonly string[] | Promise<readonly string[]>;
	/** Keep `word` as spelled right from now on. Present only when something keeps it: it's what
	 *  puts "Add to dictionary" in the menus. */
	add?(word: string): void | Promise<void>;
	/** Calls `changed` whenever the words it accepts change, so every editor sharing it asks again;
	 *  returns the call that stops. */
	watch?(changed: () => void): () => void;
}
