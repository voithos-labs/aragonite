/**
 * The registry of languages code blocks are highlighted with. Nothing outside this directory
 * imports highlight.js directly; whether a language loads eagerly is decided above this.
 * Alternate spellings resolve to their canonical name here, so no caller keeps its own table.
 * Every read takes an editor's activation, so a plugin's language shows only where it is listed.
 */

import type { LanguageFn } from 'highlight.js';
import type { PluginActivation } from '../../../schema/plugin-activation';
import { registerAsCore } from '../../../schema/plugin-install';
import { createPluginRegistry } from '../../../schema/plugin-registry';

export interface LanguageGrammar {
	readonly name: string;
	readonly definition: LanguageFn;
}

interface RegisteredLanguage extends LanguageGrammar {
	readonly aliases: readonly string[];
}

// Filled by the code bootstrap, whose languages survive the test reset.
const builtinNames = new Set<string>();

const grammars = createPluginRegistry<string, RegisteredLanguage>({
	label: 'registerLanguage',
	isBuiltin: (name) => builtinNames.has(name)
});

/** Register-once: a name already taken throws (a dev server replaces). */
export function registerLanguage(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[] = []
): void {
	const key = name.toLowerCase();
	grammars.register(
		key,
		{
			name: key,
			definition,
			aliases: [...new Set(aliasList.map((alias) => alias.toLowerCase()))]
		},
		`registerLanguage: "${key}" is already registered. Languages are register-once.`
	);
}

/** The code bootstrap's entry: a language the test reset keeps, owned by no plugin. */
export function registerBuiltinLanguage(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[] = []
): void {
	builtinNames.add(name.toLowerCase());
	registerAsCore(() => registerLanguage(name, definition, aliasList));
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
	const trimmed = infoString.trim();
	if (trimmed.length === 0) return null;

	return grammars.get(canonicalName(trimmed.split(/\s+/)[0], activation), activation) ?? null;
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
