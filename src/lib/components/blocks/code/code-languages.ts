/**
 * Language registry for code-block tokenization. Nothing outside this directory
 * imports highlight.js directly; static vs. dynamic loading is a policy on top.
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

/** Info strings with trailing attributes (`js {1-3}`) resolve on the first token. */
export function getLanguageGrammar(infoString: string): LanguageGrammar | null {
	const trimmed = infoString.trim();
	if (trimmed.length === 0) return null;

	const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
	const resolvedName = aliases.get(firstToken) ?? firstToken;
	return grammars.get(resolvedName) ?? null;
}

/**
 * Every registered grammar name, plus every alias, sorted — what the language picker
 * offers. Aliases are listed as their own entries: a user typing `js` should find it
 * rather than having to know it resolves to `javascript`.
 */
export function listLanguages(): string[] {
	const names = new Set<string>(grammars.keys());
	for (const alias of aliases.keys()) names.add(alias);
	return [...names].sort();
}

/** Test-only: clear all registered languages. */
export function __resetRegistryForTests(): void {
	grammars.clear();
	aliases.clear();
}
