/**
 * Every grammar highlight.js ships beyond the default languages, for a host that wants them all:
 * `highlightJs({ languages: allLanguages })`, from `@voithos-labs/aragonite-highlight/languages`.
 * Each loads the first time a fence names it, and the picker lists them after the default rows.
 */
import { CATALOG } from './catalog';
import { DEFAULT_LANGUAGES } from './default-languages';
import type { LanguageSource } from './resolver';

/** highlight.js's other grammars by name, each with its other spellings; spread it to add your own. */
export const allLanguages: Readonly<Record<string, LanguageSource>> = otherGrammars();

function otherGrammars(): Record<string, LanguageSource> {
	const bundled = new Set(DEFAULT_LANGUAGES.map((language) => language.file ?? language.name));
	// A spelling the default languages answer stays theirs: highlight.js's `shell` goes by `console`.
	const held = new Set(
		DEFAULT_LANGUAGES.flatMap((language) => [language.name, ...language.aliases])
	);
	const entries = Object.entries(CATALOG).flatMap(([file, [spellings, load]]) => {
		const free = [file, ...spellings.split(' ')].filter((s) => s !== '' && !held.has(s));
		if (bundled.has(file) || free.length === 0) return [];
		return [{ name: free[0], aliases: free.slice(1), load }];
	});
	// A spelling two grammars declare goes to the later one, as highlight.js's own build registers
	// them; a name of its own beats any spelling.
	const owner = new Map<string, (typeof entries)[number]>();
	for (const entry of entries) for (const alias of entry.aliases) owner.set(alias, entry);
	for (const entry of entries) owner.set(entry.name, entry);
	return Object.fromEntries(
		entries.map((entry) => [
			entry.name,
			{ load: entry.load, aliases: entry.aliases.filter((alias) => owner.get(alias) === entry) }
		])
	);
}
