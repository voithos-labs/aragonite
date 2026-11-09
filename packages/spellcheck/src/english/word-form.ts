/** A read word list, and how a word written with any casing finds its form in it. */

export interface Replacement {
	from: string;
	to: string;
}

export interface WordList {
	/** Every form as the dictionary spells it. */
	readonly forms: ReadonlySet<string>;
	/** Every form lower-cased, for a word written in capitals. */
	readonly lowerForms: ReadonlySet<string>;
	/** Forms a suggestion never offers (the taboo list). */
	readonly noSuggest: ReadonlySet<string>;
	/** The affix file's common misspelling pairs, tried first when suggesting. */
	readonly replacements: readonly Replacement[];
	/** The letters a suggestion may insert or substitute, most common first. */
	readonly tryChars: string;
}

/** The list's own spelling of `word`, or null: a capitalised word matches its lower-case entry (a
 *  sentence start), and a word in capitals matches any casing. */
export function knownForm(words: WordList, word: string): string | null {
	if (words.forms.has(word)) return word;
	const lower = word.toLowerCase();
	if (word === lower) return null;
	if (isCapitalised(word) && words.forms.has(lower)) return lower;
	if (word === word.toUpperCase() && words.lowerForms.has(lower)) return word;
	return null;
}

export function isCapitalised(word: string): boolean {
	return word[0] !== word[0].toLowerCase() && word.slice(1) === word.slice(1).toLowerCase();
}
