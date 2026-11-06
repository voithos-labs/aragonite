/**
 * The spell-check contract between the editor and whoever knows the language: a checker the
 * editor asks one word at a time, and the modes the `spellcheck` prop takes. The editor never
 * decides on its own whether a word is spelled right.
 */

/** `'on'` is the editor's own checker (the `spellChecker` prop, else the built-in English one),
 *  `'native'` the browser's, which underlines but offers nothing, and `'off'` neither. */
export type SpellcheckMode = 'on' | 'native' | 'off';

/**
 * A host's checker, set once at mount. Each method may answer at once or with a promise; the
 * editor asks for a word once and keeps the verdict, so a slow `check` is paid per distinct word.
 */
export interface SpellChecker {
	/** Whether `word` is spelled right. Asked with the word as written, capitals included. */
	check(word: string): boolean | Promise<boolean>;
	/** Replacements for a misspelled word, best first, empty for none. Asked only when a menu
	 *  opens over the word, never while typing. */
	suggest(word: string): readonly string[] | Promise<readonly string[]>;
	/** Remember `word` as spelled right from now on. Absent, the menus offer no "Add to
	 *  dictionary" row. */
	addWord?(word: string): void | Promise<void>;
}
