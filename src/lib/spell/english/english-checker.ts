/**
 * The built-in English checker: the SCOWL en_US dictionary, loaded on the first check so an
 * editor that never shows a word pays nothing, and a suggester that tries the affix file's
 * common confusions, then one edit, a split into two words, then two edits.
 */

import type { SpellChecker } from '../types';
import type { Dictionary } from './dictionary';
import { readDictionary } from './dictionary';

export interface EnglishSpellCheckerOptions {
	/** Words accepted beyond the dictionary, as the host saved them. */
	words?: Iterable<string>;
	/** Called with each word added through "Add to dictionary", so a host can keep it. */
	onAddWord?: (word: string) => void;
}

const MAX_SUGGESTIONS = 5;
/** Two-edit candidates grow with the square of the word, so a long word gets one edit only. */
const TWO_EDIT_MAX_LENGTH = 12;

export function createEnglishSpellChecker(options: EnglishSpellCheckerOptions = {}): SpellChecker {
	const added = new Set<string>();
	for (const word of options.words ?? []) added.add(normalize(word));
	let dictionary: Dictionary | null = null;
	let loading: Promise<Dictionary> | null = null;

	function load(): Promise<Dictionary> {
		loading ??= import('./dictionary-en-us').then(({ AFF, DIC }) => {
			dictionary = readDictionary(AFF, DIC);
			return dictionary;
		});
		return loading;
	}

	function isKnown(dict: Dictionary, word: string): boolean {
		return added.has(word) || knownForm(dict, word) !== null;
	}

	return {
		check(word) {
			const w = normalize(word);
			return dictionary ? isKnown(dictionary, w) : load().then((dict) => isKnown(dict, w));
		},
		suggest(word) {
			const w = normalize(word);
			return dictionary ? suggestFor(dictionary, w) : load().then((dict) => suggestFor(dict, w));
		},
		addWord(word) {
			added.add(normalize(word));
			options.onAddWord?.(word);
		}
	};
}

let shared: SpellChecker | null = null;

/** The checker an editor with no `spellChecker` prop uses: one per page, so two editors share a
 *  dictionary, and a word added in one is accepted in the other. */
export function sharedEnglishSpellChecker(): SpellChecker {
	shared ??= createEnglishSpellChecker();
	return shared;
}

// ── Checking ─────────────────────────────────────────────────────────────────

/** The typographic apostrophe reads as the plain one, which is how the dictionary spells it. */
function normalize(word: string): string {
	return word.replace(/’/g, "'");
}

/** The dictionary's own spelling of `word`, or null: a capitalised word matches its lower-case
 *  entry (a sentence start), and a word in capitals matches any casing. */
function knownForm(dict: Dictionary, word: string): string | null {
	if (dict.forms.has(word)) return word;
	const lower = word.toLowerCase();
	if (word === lower) return null;
	if (isCapitalised(word) && dict.forms.has(lower)) return lower;
	if (word === word.toUpperCase() && dict.lowerForms.has(lower)) return word;
	return null;
}

function isCapitalised(word: string): boolean {
	return word[0] !== word[0].toLowerCase() && word.slice(1) === word.slice(1).toLowerCase();
}

// ── Suggesting ───────────────────────────────────────────────────────────────

type Casing = 'lower' | 'capitalised' | 'upper' | 'mixed';

function casingOf(word: string): Casing {
	if (word === word.toLowerCase()) return 'lower';
	if (word === word.toUpperCase()) return 'upper';
	return isCapitalised(word) ? 'capitalised' : 'mixed';
}

function recase(candidate: string, casing: Casing): string {
	if (casing === 'upper') return candidate.toUpperCase();
	if (casing === 'capitalised') return candidate[0].toUpperCase() + candidate.slice(1);
	return candidate;
}

function suggestFor(dict: Dictionary, word: string): string[] {
	const casing = casingOf(word);
	// Candidates are made from the lower-case word and recased after, so `Teh` offers `The`.
	const base = casing === 'mixed' ? word : word.toLowerCase();
	const scored = new Map<string, number>();

	/** Keeps the dictionary's spelling of a candidate at its cheapest cost. */
	const consider = (candidate: string, cost: number): void => {
		const parts = candidate.split(' ');
		const known = parts.map(
			(part) => knownForm(dict, part) ?? knownForm(dict, recase(part, casing))
		);
		if (known.some((part) => part === null || dict.noSuggest.has(part))) return;
		// A proper noun keeps the dictionary's capitals; anything else takes the word's casing.
		const spelled = known
			.map((part, i) => (part === parts[i] ? recase(part, casing) : part!))
			.join(' ');
		if (spelled === word) return;
		// A two-letter answer to a longer word is a symbol or an interjection, rarely the fix.
		if (spelled.length < 3 && base.length >= 3) cost += 2;
		if (spelled[0].toLowerCase() !== base[0].toLowerCase()) cost += 0.5;
		const held = scored.get(spelled);
		if (held === undefined || cost < held) scored.set(spelled, cost);
	};

	// A word right but for its capitals (`paris`, `monday`).
	if (casing === 'lower') consider(base[0].toUpperCase() + base.slice(1), -1);
	for (const candidate of replacementCandidates(base, dict.replacements)) consider(candidate, 0);
	const oneEdit = editsOf(base, dict.tryChars);
	for (const { candidate, cost } of oneEdit) consider(candidate, cost);
	for (let i = 1; i < base.length; i++) {
		const head = base.slice(0, i);
		const tail = base.slice(i);
		if (standsAlone(head) && standsAlone(tail)) consider(`${head} ${tail}`, 2);
	}
	// Two edits only when one finds nothing: the search squares with the word, and its answers
	// beside a one-edit fix are noise (`occurrences` under `occurence`).
	if (scored.size === 0 && base.length <= TWO_EDIT_MAX_LENGTH) {
		const firsts = new Map<string, number>();
		for (const { candidate, cost } of oneEdit) {
			if (!firsts.has(candidate)) firsts.set(candidate, cost);
		}
		for (const [first, cost] of firsts) {
			for (const second of editsOf(first, dict.tryChars)) {
				consider(second.candidate, 3 + cost + second.cost);
			}
		}
	}
	return [...scored.entries()]
		.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_SUGGESTIONS)
		.map(([spelled]) => spelled);
}

function replacementCandidates(word: string, replacements: readonly Replacement[]): string[] {
	const out: string[] = [];
	for (const { from, to } of replacements) {
		let at = word.indexOf(from);
		while (at >= 0) {
			out.push(word.slice(0, at) + to + word.slice(at + from.length));
			at = word.indexOf(from, at + 1);
		}
	}
	return out;
}

/** A half of a split word: two letters or more, or one of the two one-letter words. */
function standsAlone(part: string): boolean {
	return part.length >= 2 || part === 'a' || part === 'i';
}

interface Edit {
	candidate: string;
	cost: number;
}

/** Every string one edit away, costed by how often each slip happens: swapped neighbours and
 *  a dropped letter are the common ones, a wrong or an extra letter less so. */
function editsOf(word: string, tryChars: string): Edit[] {
	const out: Edit[] = [];
	for (let i = 0; i < word.length - 1; i++) {
		out.push({
			candidate: word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2),
			cost: 0.5
		});
	}
	for (let i = 0; i <= word.length; i++) {
		for (const ch of tryChars)
			out.push({ candidate: word.slice(0, i) + ch + word.slice(i), cost: 1 });
	}
	for (let i = 0; i < word.length; i++) {
		for (const ch of tryChars) {
			out.push({ candidate: word.slice(0, i) + ch + word.slice(i + 1), cost: 1.5 });
		}
	}
	for (let i = 0; i < word.length; i++) {
		out.push({ candidate: word.slice(0, i) + word.slice(i + 1), cost: 1.5 });
	}
	return out;
}

type Replacement = Dictionary['replacements'][number];
