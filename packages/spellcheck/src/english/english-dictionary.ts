/**
 * The built-in English dictionary: SCOWL en_US, loaded on the first check so an editor that never
 * checks a word never fetches it. Each call makes its own dictionary with its own added words;
 * pass one to two editors and they share them.
 */

import type { Dictionary } from '../dictionary';
import { knownForm, readHunspell, type WordList } from './hunspell';
import { suggestFor } from './suggester';

export interface EnglishDictionaryOptions {
	/** Words accepted beyond the dictionary, as the host saved them. */
	words?: Iterable<string>;
	/** Called with each word added through "Add to dictionary", as the user wrote it; the host keeps
	 *  it. Absent, the menus offer no "Add to dictionary", since nothing would keep the word. */
	onAddWord?: (word: string) => void | Promise<void>;
}

export function englishDictionary(options: EnglishDictionaryOptions = {}): Dictionary {
	// Lower-cased, so a word added at a sentence start is accepted mid-sentence too.
	const added = new Set<string>();
	for (const word of options.words ?? []) added.add(key(word));
	const watchers = new Set<() => void>();

	const isKnown = (words: WordList, word: string): boolean =>
		added.has(key(word)) || knownForm(words, normalize(word)) !== null;
	const suggestions = (words: WordList, word: string): string[] =>
		suggestFor(words, normalize(word));

	const dictionary: Dictionary = {
		check(word) {
			if (!isEnglishShaped(word)) return true;
			return loaded ? isKnown(loaded, word) : loadWords().then((words) => isKnown(words, word));
		},
		suggest(word) {
			if (!isEnglishShaped(word)) return [];
			return loaded
				? suggestions(loaded, word)
				: loadWords().then((words) => suggestions(words, word));
		},
		watch(changed) {
			watchers.add(changed);
			return () => void watchers.delete(changed);
		}
	};
	const { onAddWord } = options;
	if (onAddWord) {
		dictionary.add = (word) => {
			added.add(key(word));
			for (const changed of [...watchers]) changed();
			return onAddWord(word);
		};
	}
	return dictionary;
}

// ── The word list ────────────────────────────────────────────────────────────

// Immutable once read, so every English dictionary on the page shares one load.
let loaded: WordList | null = null;
let loading: Promise<WordList> | null = null;

function loadWords(): Promise<WordList> {
	loading ??= import('./en-us-data').then(({ AFF, DIC }) => (loaded = readHunspell(AFF, DIC)));
	return loading;
}

// ── Words ────────────────────────────────────────────────────────────────────

const LATIN = /\p{Script=Latin}/u;

/** A word with no Latin letter (Chinese, Cyrillic, Greek) is outside English: never flagged. */
function isEnglishShaped(word: string): boolean {
	return LATIN.test(word);
}

/** The word as the list spells it: accents stripped (the list has `cafe`, not `café`), and the
 *  typographic apostrophe read as the plain one. */
function normalize(word: string): string {
	return word.normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'");
}

const key = (word: string): string => normalize(word).toLowerCase();
