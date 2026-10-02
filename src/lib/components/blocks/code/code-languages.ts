/**
 * The registry of languages code blocks are highlighted with. Nothing outside this directory
 * imports highlight.js directly; whether a language loads eagerly is decided above this.
 * Alternate spellings resolve to their canonical name here, so no caller keeps its own table.
 * Every read takes an editor's activation, so a plugin's language shows only where it is listed.
 */

import type { LanguageFn } from 'highlight.js';
import type { PluginActivation } from '../../../schema/plugin-activation';
import { createPluginRegistry } from '../../../schema/plugin-registry';
import { fenceLanguage } from '../../../core/parsers/fence-syntax';

export interface LanguageGrammar {
	readonly name: string;
	readonly definition: LanguageFn;
}

interface RegisteredLanguage extends LanguageGrammar {
	readonly aliases: readonly string[];
}

const grammars = createPluginRegistry<string, RegisteredLanguage>({
	label: 'registerLanguage',
	isBuiltin: () => false
});

/** Register-once: a name already taken throws (a dev server replaces). */
export function registerLanguage(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[] = []
): void {
	const { key, language, conflict } = languageEntry(name, definition, aliasList);
	grammars.register(key, language, conflict);
}

/** The code bootstrap's entry: a language the test reset keeps, owned by no plugin. */
export function registerBuiltinLanguage(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[] = []
): void {
	const { key, language, conflict } = languageEntry(name, definition, aliasList);
	grammars.registerCore(key, language, conflict);
}

function languageEntry(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[]
): { key: string; language: RegisteredLanguage; conflict: string } {
	const key = name.toLowerCase();
	const aliases = [...new Set(aliasList.map((alias) => alias.toLowerCase()))];
	return {
		key,
		language: { name: key, definition, aliases },
		conflict: `registerLanguage: "${key}" is already registered. Languages are register-once.`
	};
}

/** Whether the name is taken, whatever the activation: the check before a guarded register. */
export function isLanguageRegistered(name: string): boolean {
	return grammars.has(name.toLowerCase());
}

/** Any spelling of a language to the one name it is registered under. A name of its own beats
 *  another language's alternate spelling, so no grammar is hidden behind somebody's nickname. */
function canonicalName(spelling: string, activation: PluginActivation): string {
	const key = spelling.toLowerCase();
	const languages = grammars.entries(activation);
	if (languages.some(([name]) => name === key)) return key;
	let canonical = key;
	for (const [name, language] of languages) if (language.aliases.includes(key)) canonical = name;
	return canonical;
}

/** Info strings with trailing attributes (`js {1-3}`) resolve on the first token. */
export function getLanguageGrammar(
	infoString: string,
	activation: PluginActivation
): LanguageGrammar | null {
	const language = fenceLanguage(infoString);
	if (language === '') return null;
	return grammars.get(canonicalName(language, activation), activation) ?? null;
}

/** Every registered language once, under its canonical name, sorted: the picker's rows. */
export function listLanguages(activation: PluginActivation): string[] {
	return grammars
		.entries(activation)
		.map(([name]) => name)
		.sort();
}

/** The alternate spellings a language answers to, from any spelling of it, so a picker's
 *  filter matches `rs` to `rust` without a table of its own. */
export function getLanguageAliases(name: string, activation: PluginActivation): readonly string[] {
	return grammars.get(canonicalName(name, activation), activation)?.aliases ?? [];
}
