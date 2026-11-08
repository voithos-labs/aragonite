/**
 * What one editor's spell check knows about words: the dictionary's answers, kept so each distinct
 * word is asked once, and its suggestions, fetched once per word. When the dictionary's words
 * change (a word added here or in another editor sharing it), every "misspelled" answer is asked
 * again.
 */

import type { Dictionary } from './dictionary';

/** Distinct words handed to the dictionary per call to `ask`; the rest wait for the next call. */
const ASK_CAP = 5000;

export interface VerdictsDeps {
	dictionary: Dictionary;
	/** An answer arrived after the call that asked for it, or the dictionary's words changed. */
	changed(): void;
	/** A dictionary's throw or rejection; the word then counts as spelled right. */
	onError(error: unknown): void;
}

export interface Verdicts {
	/** True only once the dictionary has said `word` is misspelled. */
	misspelled(word: string): boolean;
	/** Asks about each word not answered and not on its way; an answer given at once is kept
	 *  before this returns. */
	ask(words: Iterable<string>): void;
	/** Replacements for `word`, best first, asked of the dictionary once per word. */
	suggestions(word: string): Promise<readonly string[]>;
	/** The suggestions already fetched, or null while they're on their way (the first call starts
	 *  the fetch). */
	peekSuggestions(word: string): readonly string[] | null;
	/** Whether the dictionary keeps added words, which is what shows "Add to dictionary". */
	readonly canAdd: boolean;
	add(word: string): Promise<void>;
	dispose(): void;
}

export function createVerdicts(deps: VerdictsDeps): Verdicts {
	const { dictionary } = deps;
	const answers = new Map<string, boolean>();
	const pending = new Set<string>();
	const fetches = new Map<string, Promise<readonly string[]>>();
	const fetched = new Map<string, readonly string[]>();
	let live = true;

	function settle(word: string, ok: boolean, error?: unknown): void {
		pending.delete(word);
		if (!live) return;
		if (error !== undefined) deps.onError(error);
		answers.set(word, ok);
		deps.changed();
	}

	function forgetMisspelled(): void {
		for (const [word, ok] of answers) if (!ok) answers.delete(word);
	}

	const unwatch = dictionary.watch?.(() => {
		forgetMisspelled();
		deps.changed();
	});

	function suggestions(word: string): Promise<readonly string[]> {
		const held = fetches.get(word);
		if (held) return held;
		const fetch = (async () => {
			try {
				return await dictionary.suggest(word);
			} catch (error) {
				deps.onError(error);
				return [];
			}
		})().then((list) => {
			fetched.set(word, list);
			return list;
		});
		fetches.set(word, fetch);
		return fetch;
	}

	return {
		misspelled: (word) => answers.get(word) === false,
		ask(words) {
			let asked = 0;
			for (const word of words) {
				if (answers.has(word) || pending.has(word)) continue;
				if (asked++ >= ASK_CAP) return;
				let answer: boolean | Promise<boolean>;
				try {
					answer = dictionary.check(word);
				} catch (error) {
					deps.onError(error);
					answers.set(word, true);
					continue;
				}
				if (typeof answer === 'boolean') {
					answers.set(word, answer);
					continue;
				}
				pending.add(word);
				answer.then(
					(ok) => settle(word, ok),
					(error: unknown) => settle(word, true, error)
				);
			}
		},
		suggestions,
		peekSuggestions(word) {
			const held = fetched.get(word);
			if (held) return held;
			void suggestions(word);
			return null;
		},
		get canAdd() {
			return !!dictionary.add;
		},
		async add(word) {
			if (!dictionary.add) return;
			try {
				await dictionary.add(word);
			} catch (error) {
				deps.onError(error);
			}
			// A dictionary that says nothing of its own changes still learned this one.
			if (!dictionary.watch) {
				forgetMisspelled();
				deps.changed();
			}
		},
		dispose() {
			live = false;
			unwatch?.();
		}
	};
}
