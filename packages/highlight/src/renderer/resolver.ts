/**
 * Which grammar a fence's language gets. The default resolver answers every highlight.js grammar:
 * the eager set at once, and any other as a promise of its own chunk. The engine asks once per
 * language and keeps the answer, so a resolver needs no memory of its own.
 */
import type { LanguageFn } from 'highlight.js';
import type { CodeLanguage } from '@voithos-labs/aragonite/plugin';
import { CATALOG } from './catalog';
import { EAGER } from './eager';

/** Answers which grammar a language gets, and lists what it answers. */
export interface LanguageResolver {
	/** The grammar for a language in any spelling: now, once it loads, or null for none. An editor
	 *  asks once per language; a rejection leaves that language plain there. */
	resolve(name: string): LanguageFn | Promise<LanguageFn> | null;
	/** Every language `resolve` answers, once each with its other spellings: the picker's rows. */
	readonly languages: readonly CodeLanguage[];
}

// Spellings that painted before the package and would paint differently or plain by highlight.js's
// own tables, each kept on the grammar that painted it.
const KEPT_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
	// highlight.js reads `shell` as a shell session (prompts); GitHub and the core read a script.
	bash: ['shell'],
	// highlight.js knows no `htm`, which the core painted as HTML.
	xml: ['htm']
};

interface Entry extends CodeLanguage {
	readonly file: string;
}

function catalogEntries(): Entry[] {
	const kept = new Set(Object.values(KEPT_SPELLINGS).flat());
	return Object.entries(CATALOG).map(([file, [spellings]]) => {
		const aliases = [
			...(spellings === '' ? [] : spellings.split(' ')),
			...(KEPT_SPELLINGS[file] ?? [])
		];
		// A grammar whose name another now keeps goes by its first spelling nobody else keeps.
		if (!kept.has(file) || KEPT_SPELLINGS[file]) return { file, name: file, aliases };
		const name = aliases.find((alias) => !kept.has(alias)) ?? file;
		return { file, name, aliases: aliases.filter((alias) => alias !== name) };
	});
}

function createDefaultResolver(): LanguageResolver {
	const entries = catalogEntries();
	// A spelling two grammars declare goes to the later one, as highlight.js's own build registers
	// them; a name of its own beats any spelling. Each spelling then names one language.
	const byName = new Map<string, Entry>();
	for (const entry of entries) for (const alias of entry.aliases) byName.set(alias, entry);
	for (const entry of entries) byName.set(entry.name, entry);
	return {
		languages: entries.map(({ name, aliases }, i) => ({
			name,
			aliases: aliases.filter((alias) => byName.get(alias) === entries[i])
		})),
		resolve(name) {
			const entry = byName.get(name.toLowerCase());
			if (!entry) return null;
			return EAGER[entry.file] ?? CATALOG[entry.file][1]!().then((module) => module.default);
		}
	};
}

/** Every highlight.js grammar: the eager set at once, the rest on demand. */
export const defaultResolver: LanguageResolver = createDefaultResolver();
