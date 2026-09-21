/**
 * The registry of languages code blocks are highlighted with. Nothing outside this directory
 * imports highlight.js directly; whether a language loads eagerly is decided above this.
 * Alternate spellings resolve to their canonical name here, so no caller keeps its own table.
 */

import type { LanguageFn } from 'highlight.js';

export interface LanguageGrammar {
	readonly name: string;
	readonly definition: LanguageFn;
}

const grammars = new Map<string, LanguageGrammar>();
const aliases = new Map<string, string>();

/** Safe to call twice: a repeat call with the same name does nothing. */
export function registerLanguage(
	name: string,
	definition: LanguageFn,
	aliasList: readonly string[] = []
): void {
	const key = name.toLowerCase();
	if (grammars.has(key)) return;
	grammars.set(key, { name: key, definition });
	for (const alias of aliasList) {
		aliases.set(alias.toLowerCase(), key);
	}
}

/** Any spelling of a language to the one name it is registered under. A name of its own beats
 *  another language's alternate spelling, so no grammar is hidden behind somebody's nickname. */
function canonicalName(spelling: string): string {
	const key = spelling.toLowerCase();
	if (grammars.has(key)) return key;
	return aliases.get(key) ?? key;
}

/** Info strings with trailing attributes (`js {1-3}`) resolve on the first token. */
export function getLanguageGrammar(infoString: string): LanguageGrammar | null {
	const trimmed = infoString.trim();
	if (trimmed.length === 0) return null;

	return grammars.get(canonicalName(trimmed.split(/\s+/)[0])) ?? null;
}

/** Every registered language once, under its canonical name, sorted: the picker's rows. */
export function listLanguages(): string[] {
	return [...grammars.keys()].sort();
}

/** The alternate spellings a language answers to, from any spelling of it, so a picker's
 *  filter matches `rs` to `rust` without a table of its own. */
export function getLanguageAliases(name: string): readonly string[] {
	const key = canonicalName(name);
	if (!grammars.has(key)) return [];
	return [...aliases].filter(([, target]) => target === key).map(([alias]) => alias);
}

/** Test-only: clear all registered languages. */
export function __resetRegistryForTests(): void {
	grammars.clear();
	aliases.clear();
}
