/**
 * The highlight plugin's highlight.js engine, kept off the plugin's main entry like the other
 * packages' engines: `highlight({ renderer: highlightJs() })`. Each editor gets its own
 * highlight.js instance, asking the grammars in `languages` first and the resolver for the rest.
 */
import HighlightJS from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import type { CodeHighlighter, CodeLanguage } from '@voithos-labs/aragonite/plugin';
import type { HighlightRenderer } from './highlight-plugin';
import { defaultResolver, type LanguageResolver } from './renderer/resolver';
import { tokensOf } from './renderer/tokens';

export { defaultResolver } from './renderer/resolver';
export type { LanguageResolver } from './renderer/resolver';
export type { LanguageFn } from 'highlight.js';

/** A grammar `languages` adds: the grammar itself, or a loader called the first time it's named. */
export type LanguageSource =
	| LanguageFn
	| {
			load(): Promise<LanguageFn | { default: LanguageFn }>;
			readonly aliases?: readonly string[];
	  };

export interface HighlightJsOptions {
	/** Grammars asked before the resolver, by name: one you wrote, or one highlight.js lacks. */
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
	const registered = new Map<string, LanguageFn>();
	const tokens = (grammar: LanguageFn, body: string, name: string) => {
		if (registered.get(name) !== grammar) {
			hljs.registerLanguage(name, grammar);
			// Another grammar's sublanguage names it by any spelling (`xml` inside a `php` fence).
			const aliases = resolver.languages.find((entry) => entry.name === name)?.aliases ?? [];
			hljs.registerAliases([...aliases], { languageName: name });
			registered.set(name, grammar);
		}
		return tokensOf(hljs, body, name);
	};
	return {
		languages: () => resolver.languages,
		highlight(body, language) {
			const name = language.toLowerCase();
			const grammar = resolver.resolve(name);
			if (grammar === null) return null;
			if (typeof grammar === 'function') return tokens(grammar, body, name);
			return grammar.then((loaded) => tokens(loaded, body, name));
		}
	};
}

function withOwnLanguages(
	sources: Readonly<Record<string, LanguageSource>>,
	resolver: LanguageResolver
): LanguageResolver {
	const names = Object.keys(sources).map((name) => name.toLowerCase());
	if (names.length === 0) return resolver;
	const loaded = new Map<string, LanguageFn | Promise<LanguageFn> | null>();
	const own = (name: string): LanguageFn | Promise<LanguageFn> | null => {
		const source = Object.entries(sources).find(([key]) => key.toLowerCase() === name)?.[1];
		if (!source) return null;
		if (typeof source === 'function') return source;
		if (!loaded.has(name)) {
			const loading = source.load().then(
				(grammar) => {
					const fn = typeof grammar === 'function' ? grammar : grammar.default;
					loaded.set(name, fn);
					return fn;
				},
				(cause: unknown) => {
					loaded.set(name, null);
					throw cause;
				}
			);
			loaded.set(name, loading);
		}
		return loaded.get(name)!;
	};
	const ownLanguages: CodeLanguage[] = Object.entries(sources).map(([name, source]) => ({
		name: name.toLowerCase(),
		aliases: typeof source === 'function' ? [] : [...(source.aliases ?? [])]
	}));
	// A spelling of the host's own leaves the bundled grammars, so each spelling names one language.
	const taken = new Set(ownLanguages.flatMap((language) => [language.name, ...language.aliases]));
	return {
		languages: [
			...ownLanguages,
			...resolver.languages
				.filter((language) => !taken.has(language.name))
				.map(({ name, aliases }) => ({
					name,
					aliases: aliases.filter((alias) => !taken.has(alias))
				}))
		],
		resolve: (name) => own(name.toLowerCase()) ?? resolver.resolve(name)
	};
}
