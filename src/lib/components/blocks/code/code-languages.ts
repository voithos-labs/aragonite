/**
 * The languages fenced code is highlighted in, read off the editor's plugins: each plugin's
 * `contributes(...).code` lists its own, and a spelling belongs to the first plugin listing it.
 * The painter asks the owner a fence's language names, and the picker lists the union.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { PluginActivation } from '../../../schema/plugin-activation';
import type { CodeLanguage } from '../../../schema/code-highlighter';
import type { ContributedHighlighter } from '../../../schema/editor-contributions';
import { fenceLanguage } from '../../../core/parsers/fence-syntax';

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

/** The code block picker's rows: every language the plugins highlight, once each, sorted. */
export function pickerLanguages(activation: PluginActivation): string[] {
	return highlighterLanguages(activation)
		.map((language) => language.name)
		.sort();
}

/** The other spellings of the language a spelling names, so the picker's filter matches `rs` to
 *  `rust` without a table of its own. */
export function pickerAliases(spelling: string, activation: PluginActivation): readonly string[] {
	const name = languageOwner(spelling, activation)?.name;
	return highlighterLanguages(activation).find((language) => language.name === name)?.aliases ?? [];
}
