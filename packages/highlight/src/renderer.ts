/**
 * The highlight plugin's highlight.js engine, kept off the plugin's main entry like the other
 * packages' engines: `highlight({ renderer: highlightJs() })`. Each editor gets its own
 * highlight.js instance, asking the grammars in `languages` first and the resolver for the rest.
 */
import HighlightJS from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import type { CodeHighlighter, CodeLanguage } from '@voithos-labs/aragonite/plugin';
import type { HighlightRenderer } from './highlight-plugin';
import { defaultResolver, type LanguageResolver, type LanguageSource } from './renderer/resolver';
import { tokensOf } from './renderer/tokens';

export { defaultResolver } from './renderer/resolver';
export type { LanguageResolver, LanguageSource } from './renderer/resolver';
export type { LanguageFn } from 'highlight.js';

export interface HighlightJsOptions {
	/** Grammars asked before the resolver, by name: one you wrote, one the default languages lack,
	 *  or `allLanguages` from `/languages` for every grammar highlight.js ships. */
	languages?: Readonly<Record<string, LanguageSource>>;
	/** Answers every name `languages` doesn't; `defaultResolver` unless you bring your own. */
	resolver?: LanguageResolver;
}

/** highlight.js as the plugin's renderer: the eager set at once, every other grammar on demand. */
export function highlightJs(options: Readonly<HighlightJsOptions> = {}): HighlightRenderer {
	return () => createHighlighter(options);
}

/** The languages an editor running `highlightJs(options)` answers, as its picker lists them. */
export function listLanguages(options: Readonly<HighlightJsOptions> = {}): readonly CodeLanguage[] {
	return withOwnLanguages(options.languages ?? {}, options.resolver ?? defaultResolver).languages;
}

function createHighlighter(options: Readonly<HighlightJsOptions>): CodeHighlighter {
	const hljs = HighlightJS.newInstance();
	const resolver = withOwnLanguages(options.languages ?? {}, options.resolver ?? defaultResolver);
	// Each name's grammar once asked for: in hand, on its way, or null after a load that failed. The
	// resolver is asked once per name, so one that answers a new promise each time costs no more.
	const grammars = new Map<string, LanguageFn | Promise<LanguageFn> | null>();
	const register = (name: string, grammar: LanguageFn): LanguageFn => {
		hljs.registerLanguage(name, grammar);
		// Another grammar's sublanguage names it by any spelling (`xml` inside a `php` fence).
		const aliases = resolver.languages.find((entry) => entry.name === name)?.aliases ?? [];
		hljs.registerAliases([...aliases], { languageName: name });
		grammars.set(name, grammar);
		return grammar;
	};
	const grammarOf = (name: string): LanguageFn | Promise<LanguageFn> | null => {
		if (grammars.has(name)) return grammars.get(name)!;
		const answer = resolver.resolve(name);
		if (answer === null) return null;
		if (typeof answer === 'function') return register(name, answer);
		const loading = answer.then(
			(grammar) => register(name, typeof grammar === 'function' ? grammar : grammar.default),
			(cause: unknown) => {
				grammars.set(name, null);
				throw cause;
			}
		);
		grammars.set(name, loading);
		return loading;
	};
	return {
		languages: () => resolver.languages,
		highlight(body, language) {
			const name = language.toLowerCase();
			const grammar = grammarOf(name);
			if (grammar === null) return null;
			if (typeof grammar === 'function') return tokensOf(hljs, body, name);
			return grammar.then(() => tokensOf(hljs, body, name));
		}
	};
}

function withOwnLanguages(
	sources: Readonly<Record<string, LanguageSource>>,
	resolver: LanguageResolver
): LanguageResolver {
	const names = Object.keys(sources).map((name) => name.toLowerCase());
	if (names.length === 0) return resolver;
	const own = (name: string): ReturnType<LanguageResolver['resolve']> => {
		const source = Object.entries(sources).find(([key]) => key.toLowerCase() === name)?.[1];
		if (!source) return null;
		return typeof source === 'function' ? source : source.load();
	};
	const ownLanguages = Object.entries(sources).map(([name, source]) => ({
		name: name.toLowerCase(),
		aliases: typeof source === 'function' ? [] : [...(source.aliases ?? [])]
	}));
	// A spelling of the host's own leaves the bundled grammars, so each spelling names one language.
	const taken = new Set(ownLanguages.flatMap((language) => [language.name, ...language.aliases]));
	// The resolver's rows keep their places, a host's row takes the place of one it replaces, and
	// the rest follow alphabetically.
	const place = new Map(resolver.languages.map((language, i) => [language.name, i]));
	const at = (language: CodeLanguage) => place.get(language.name) ?? place.size;
	return {
		languages: [
			...ownLanguages,
			...resolver.languages
				.filter((language) => !taken.has(language.name))
				.map(({ name, aliases = [] }) => ({
					name,
					aliases: aliases.filter((alias) => !taken.has(alias))
				}))
		].sort((a, b) => at(a) - at(b) || (a.name < b.name ? -1 : 1)),
		resolve: (name) => own(name.toLowerCase()) ?? resolver.resolve(name)
	};
}
