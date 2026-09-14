/**
 * Language registry for code-block tokenization. Nothing outside this directory
 * imports highlight.js directly; static vs. dynamic loading is a policy on top.
 * Aliases fold to their canonical name here, so no caller carries its own table.
 */

import type { LanguageFn } from 'highlight.js';

export interface LanguageGrammar {
	readonly name: string;
	readonly definition: LanguageFn;
}

const grammars = new Map<string, LanguageGrammar>();
const aliases = new Map<string, string>();

/** Idempotent — repeat calls with the same name are no-ops. */
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

/** The fold: any spelling of a language to the one name it is registered under. A name of its
 *  own beats another language's alias, so no grammar is shadowed by somebody's nickname. */
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

/** Every registered language once, under its canonical name, sorted — the picker's rows. */
export function listLanguages(): string[] {
	return [...grammars.keys()].sort();
}

/** The alternate spellings a registered language answers to, under the name `listLanguages`
 *  returns it as, so a picker's filter matches `rs` to `rust` without its own table. */
export function getLanguageAliases(name: string): readonly string[] {
	const key = name.toLowerCase();
	if (!grammars.has(key)) return [];
	return [...aliases].filter(([, target]) => target === key).map(([alias]) => alias);
}

/** Test-only: clear all registered languages. */
export function __resetRegistryForTests(): void {
	grammars.clear();
	aliases.clear();
}
