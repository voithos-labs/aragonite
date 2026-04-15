/**
 * Language registry for code-block tokenization. All tokenizer access goes
 * through here — nothing outside `code-surface/` imports highlight.js directly.
 * Plugin seam: static vs. dynamic loading is a policy on top of `registerLanguage`.
 */

import type { LanguageFn } from 'highlight.js';

export interface LanguageGrammar {
	readonly name: string;
	readonly definition: LanguageFn;
}

const grammarsByName = new Map<string, LanguageGrammar>();
const aliasToName = new Map<string, string>();

/** Idempotent — calls after the first with the same name are no-ops. */
export function registerLanguage(
	name: string,
	definition: LanguageFn,
	aliases: readonly string[] = []
): void {
	const key = name.toLowerCase();
	if (grammarsByName.has(key)) return;
	grammarsByName.set(key, { name: key, definition });
	for (const alias of aliases) {
		aliasToName.set(alias.toLowerCase(), key);
	}
}

/** Info strings with trailing attributes (`js {1-3}`) resolve on the first token. */
export function getLanguageGrammar(infoString: string): LanguageGrammar | null {
	const trimmed = infoString.trim();
	if (trimmed.length === 0) return null;

	const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
	const resolvedName = aliasToName.get(firstToken) ?? firstToken;
	return grammarsByName.get(resolvedName) ?? null;
}

/** Test-only: clear all registered languages. */
export function __resetRegistryForTests(): void {
	grammarsByName.clear();
	aliasToName.clear();
}
