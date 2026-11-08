import { describe, expect, it, vi } from 'vitest';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import { createVerdicts } from '#packages/spellcheck/src/verdicts.js';

/** A dictionary over a word list, answering at once or through promises the test resolves. */
function scripted(known: string[], opts: { async?: boolean; add?: boolean; watch?: boolean } = {}) {
	const words = new Set(known);
	const waiting = new Map<string, (ok: boolean) => void>();
	const watchers = new Set<() => void>();
	const check = vi.fn((word: string): boolean | Promise<boolean> =>
		opts.async ? new Promise<boolean>((resolve) => waiting.set(word, resolve)) : words.has(word)
	);
	const suggest = vi.fn((word: string) => [word.slice(1)]);
	const dictionary: Dictionary = { check, suggest };
	if (opts.add !== false) {
		dictionary.add = (word) => {
			words.add(word);
			for (const changed of watchers) changed();
		};
	}
	if (opts.watch !== false) {
		dictionary.watch = (changed) => {
			watchers.add(changed);
			return () => void watchers.delete(changed);
		};
	}
	return {
		dictionary,
		check,
		suggest,
		watchers,
		/** Answers every waiting question from the word list. */
		answerAll() {
			for (const [word, resolve] of waiting) resolve(words.has(word));
			waiting.clear();
		}
	};
}

function verdictsOver(dictionary: Dictionary) {
	const changed = vi.fn();
	const onError = vi.fn();
	return { verdicts: createVerdicts({ dictionary, changed, onError }), changed, onError };
}

describe('createVerdicts: asking', () => {
	it('asks each distinct word once and keeps an answer given at once', () => {
		const script = scripted(['the', 'cat']);
		const { verdicts, changed } = verdictsOver(script.dictionary);
		verdicts.ask(['the', 'catt', 'the', 'catt']);
		expect(verdicts.misspelled('catt')).toBe(true);
		expect(verdicts.misspelled('the')).toBe(false);
		verdicts.ask(['catt']);
		expect(script.check.mock.calls.map(([word]) => word)).toEqual(['the', 'catt']);
		expect(changed).not.toHaveBeenCalled();
	});

	it('calls nothing misspelled until a late answer lands, then says so once per answer', async () => {
		const script = scripted(['one'], { async: true });
		const { verdicts, changed } = verdictsOver(script.dictionary);
		verdicts.ask(['one', 'tow']);
		verdicts.ask(['tow']);
		expect(verdicts.misspelled('tow')).toBe(false);
		script.answerAll();
		await Promise.resolve();
		expect(verdicts.misspelled('tow')).toBe(true);
		expect(changed).toHaveBeenCalledTimes(2);
		expect(script.check).toHaveBeenCalledTimes(2);
	});

	it('reports a throw or a rejection once, and counts the word as spelled right', async () => {
		const { verdicts, onError } = verdictsOver({
			check: (word) => {
				if (word === 'sync') throw new Error('no list');
				return Promise.reject(new Error('offline'));
			},
			suggest: () => []
		});
		verdicts.ask(['sync', 'late']);
		await Promise.resolve();
		await Promise.resolve();
		expect(verdicts.misspelled('sync')).toBe(false);
		expect(verdicts.misspelled('late')).toBe(false);
		expect(onError).toHaveBeenCalledTimes(2);
	});

	it('hands the dictionary at most 5,000 new words a call, and the rest on the next', () => {
		const script = scripted([]);
		const { verdicts } = verdictsOver(script.dictionary);
		const many = Array.from({ length: 5003 }, (_, i) => `w${i}`);
		verdicts.ask(many);
		expect(script.check).toHaveBeenCalledTimes(5000);
		verdicts.ask(many);
		expect(script.check).toHaveBeenCalledTimes(5003);
	});
});

describe('createVerdicts: suggestions', () => {
	it('asks once per word, and peeks at what has arrived', async () => {
		const script = scripted([]);
		const { verdicts } = verdictsOver(script.dictionary);
		expect(verdicts.peekSuggestions('catt')).toBeNull();
		expect(await verdicts.suggestions('catt')).toEqual(['att']);
		expect(verdicts.peekSuggestions('catt')).toEqual(['att']);
		expect(script.suggest).toHaveBeenCalledTimes(1);
	});

	it('reports a failing suggest and offers nothing', async () => {
		const { verdicts, onError } = verdictsOver({
			check: () => false,
			suggest: () => {
				throw new Error('boom');
			}
		});
		expect(await verdicts.suggestions('catt')).toEqual([]);
		expect(onError).toHaveBeenCalledTimes(1);
	});
});

describe('createVerdicts: added words', () => {
	it('offers no add without a dictionary that keeps words', () => {
		expect(verdictsOver(scripted([], { add: false }).dictionary).verdicts.canAdd).toBe(false);
		expect(verdictsOver(scripted([]).dictionary).verdicts.canAdd).toBe(true);
	});

	it('asks again about a word once it is added, with or without a watching dictionary', async () => {
		for (const watch of [true, false]) {
			const script = scripted(['the'], { watch });
			const { verdicts, changed } = verdictsOver(script.dictionary);
			verdicts.ask(['catt']);
			await verdicts.add('catt');
			expect(changed).toHaveBeenCalledTimes(1);
			verdicts.ask(['catt']);
			expect(verdicts.misspelled('catt')).toBe(false);
		}
	});

	// Miss-analysis: every add-to-dictionary row ran one editor, so nothing asked whether an
	// editor sharing the dictionary heard about the word.
	it('a word added in one editor is asked again in another sharing the dictionary', async () => {
		const script = scripted(['the']);
		const first = verdictsOver(script.dictionary);
		const second = verdictsOver(script.dictionary);
		first.verdicts.ask(['catt']);
		second.verdicts.ask(['catt']);
		await first.verdicts.add('catt');
		expect(second.changed).toHaveBeenCalledTimes(1);
		second.verdicts.ask(['catt']);
		expect(second.verdicts.misspelled('catt')).toBe(false);
	});

	it('stops listening and ignores late answers once disposed', async () => {
		const script = scripted([], { async: true });
		const { verdicts, changed } = verdictsOver(script.dictionary);
		verdicts.ask(['late']);
		verdicts.dispose();
		script.answerAll();
		await Promise.resolve();
		expect(changed).not.toHaveBeenCalled();
		expect(script.watchers.size).toBe(0);
	});
});
