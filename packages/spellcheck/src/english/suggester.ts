/**
 * Suggestions for a misspelled English word: the affix file's common confusions, then one edit, a
 * split into two words, then two edits, each scored by how often that slip happens.
 */

import { isCapitalised, knownForm, type WordList } from './word-form';

export const MAX_SUGGESTIONS = 5;
/** Two-edit candidates grow with the square of the word, so a long word gets one edit only. */
const TWO_EDIT_MAX_LENGTH = 12;
/** Second edits tried at most: plenty for a real two-letter slip, and a bound on a word with none. */
const SECOND_EDIT_BUDGET = 150_000;

type Casing = 'lower' | 'capitalised' | 'upper' | 'mixed';

export function suggestFor(dict: WordList, word: string): string[] {
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
	if (scored.size === 0 && casing !== 'mixed' && base.length <= TWO_EDIT_MAX_LENGTH) {
		const letters = [...new Set(dict.tryChars.toLowerCase())].join('');
		// In the one-edit list's order, which is cheapest first, so the budget goes to likely slips.
		const firsts = new Map<string, number>();
		for (const { candidate, cost } of oneEdit) {
			if (candidate === candidate.toLowerCase() && !firsts.has(candidate))
				firsts.set(candidate, cost);
		}
		let budget = SECOND_EDIT_BUDGET;
		search: for (const [first, cost] of firsts) {
			for (const second of editsOf(first, letters)) {
				if (budget-- <= 0) break search;
				// One lookup rules out nearly every candidate; only a hit pays for the full check.
				if (dict.lowerForms.has(second.candidate))
					consider(second.candidate, 3 + cost + second.cost);
			}
		}
	}
	return [...scored.entries()]
		.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_SUGGESTIONS)
		.map(([spelled]) => spelled);
}

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

function replacementCandidates(word: string, replacements: WordList['replacements']): string[] {
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
