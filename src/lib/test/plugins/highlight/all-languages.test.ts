// The opt-in set: every grammar highlight.js ships beyond the default set, as a host hands it to the
// engine with `highlightJs({ languages: allLanguages })`.
import { describe, expect, it } from 'vitest';
import HighlightJS from 'highlight.js/lib/core';
import { allLanguages } from '#packages/highlight/src/renderer/all-languages.js';
import { defaultResolver } from '#packages/highlight/src/renderer/resolver.js';
import { listLanguages } from '#packages/highlight/src/renderer.js';

const spellingsOf = (languages: readonly { name: string; aliases?: readonly string[] }[]) =>
	languages.flatMap((language) => [language.name, ...(language.aliases ?? [])]);

describe('allLanguages', () => {
	const entries = Object.entries(allLanguages).map(([name, source]) => ({
		name,
		aliases: typeof source === 'function' ? [] : (source.aliases ?? [])
	}));

	it('holds every other grammar highlight.js ships, each loading its own', async () => {
		expect(entries.length).toBe(169);
		const nix = allLanguages.nix;
		if (typeof nix === 'function') throw new Error('nix is a loader');
		const grammar = (await nix.load()) as { default: (api: unknown) => { name: string } };
		expect(grammar.default(HighlightJS.newInstance()).name).toBe('Nix');
	});

	// Miss-analysis: the default set and the catalog were one list, so no row held a spelling the
	// default answers away from a grammar the host opts into.
	it('answers no spelling the default set answers, so `shell` stays bash and highlight.js’s goes by console', () => {
		const held = new Set(spellingsOf(defaultResolver.languages));
		expect(spellingsOf(entries).filter((spelling) => held.has(spelling))).toEqual([]);
		expect(entries.find((entry) => entry.name === 'console')?.aliases).toEqual(['shellsession']);
	});

	it('names each spelling once, a later grammar keeping one two declare', () => {
		const spellings = spellingsOf(entries);
		expect(spellings.length).toBe(new Set(spellings).size);
		expect(entries.find((entry) => entry.name === 'livescript')?.aliases).toContain('ls');
		expect(entries.find((entry) => entry.name === 'lasso')?.aliases).not.toContain('ls');
	});

	it('lists the default rows first, in their order, then every other grammar alphabetically', () => {
		const names = listLanguages({ languages: allLanguages }).map((language) => language.name);
		const defaults = defaultResolver.languages.map((language) => language.name);
		expect(names.slice(0, defaults.length)).toEqual(defaults);
		const rest = names.slice(defaults.length);
		expect(rest).toEqual(entries.map((entry) => entry.name).sort());
	});
});
