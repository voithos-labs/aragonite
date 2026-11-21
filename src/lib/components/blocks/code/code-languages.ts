/**
 * The registry of languages code blocks are highlighted with. Nothing outside this directory
 * imports highlight.js directly; whether a language loads eagerly is decided above this.
 * Alternate spellings resolve to their canonical name here, so no caller keeps its own table.
 * Every read takes an editor's activation, so a plugin's language shows only where it is listed.
 */

import type { LanguageFn } from 'highlight.js';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { PluginActivation } from '../../../schema/plugin-activation';
import type { CodeLanguage } from '../../../schema/code-highlighter';
import type { ContributedHighlighter } from '../../../schema/editor-contributions';
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

// ── The plugins' highlighters ────────────────────────────────────────────────

/** A language a plugin highlights: its name, and the asking bound to the plugin listing it first. */
export interface LanguageOwner {
	readonly name: string;
	highlight(body: string): ReturnType<ContributedHighlighter['highlight']>;
}

interface LanguageTable {
	readonly lists: readonly (readonly CodeLanguage[])[];
	readonly union: readonly CodeLanguage[];
	readonly owners: ReadonlyMap<string, LanguageOwner>;
}

const tables = new WeakMap<readonly ContributedHighlighter[], LanguageTable>();

/** Every plugin's languages in list order, each spelling kept by the first plugin listing it. Built
 *  again only when a plugin hands back a different list. */
function languageTable(activation: PluginActivation): LanguageTable {
	const highlighters = activation.contributions?.highlighters ?? [];
	const lists = highlighters.map((highlighter) => highlighter.languages());
	const held = tables.get(highlighters);
	if (held && held.lists.every((list, i) => list === lists[i])) return held;
	const owners = new Map<string, LanguageOwner>();
	const union: CodeLanguage[] = [];
	lists.forEach((list, i) => {
		for (const language of list) {
			const spellings = [language.name, ...language.aliases].map((s) => s.toLowerCase());
			const taken = spellings.filter((spelling) => owners.has(spelling));
			if (taken.length > 0)
				devWarn(
					'code-language-owner',
					`${highlighters[i].plugin} lists ${taken.join(', ')}, which an earlier plugin answers`
				);
			if (taken.includes(spellings[0])) continue;
			const owner: LanguageOwner = {
				name: spellings[0],
				highlight: (body) => highlighters[i].highlight(body, language.name)
			};
			const free = spellings.filter((spelling) => !owners.has(spelling));
			for (const spelling of free) owners.set(spelling, owner);
			union.push({ name: spellings[0], aliases: free.slice(1) });
		}
	});
	const table = { lists, union, owners };
	tables.set(highlighters, table);
	return table;
}

/** The plugin highlighter answering a fence's spelling (its first word), or null for none. */
export function languageOwner(
	spelling: string,
	activation: PluginActivation
): LanguageOwner | null {
	const key = fenceLanguage(spelling).toLowerCase();
	return key === '' ? null : (languageTable(activation).owners.get(key) ?? null);
}

/** Every language the plugins highlight, once each, in list order. */
export function highlighterLanguages(activation: PluginActivation): readonly CodeLanguage[] {
	return languageTable(activation).union;
}
