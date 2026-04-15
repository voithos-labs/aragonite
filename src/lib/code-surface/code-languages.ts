/**
 * Language registry for code-block tokenization. All tokenizer access goes
 * through here — nothing outside `code-surface/` imports highlight.js directly.
 * Plugin seam: static vs. dynamic loading is a policy on top of `registerLanguage`.
 */

import type { LanguageFn } from 'highlight.js';

export interface LanguageGrammar {
	/** Lowercased canonical name — always the first-registration form. */
	readonly name: string;
	readonly definition: LanguageFn;
}

const grammars = new Map<string, LanguageGrammar>();
const aliases = new Map<string, string>();

/** Idempotent — calls after the first with the same name are no-ops. */
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

/** Test-only: clear all registered languages. */
export function __resetRegistryForTests(): void {
	grammars.clear();
	aliases.clear();
}
