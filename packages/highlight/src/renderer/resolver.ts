/**
 * Which grammar a fence's language gets. The default resolver answers the default languages: the
 * eager set at once, and any other as a promise of its own chunk. The engine asks once per language
 * and keeps the answer, so a resolver needs no memory of its own.
 */
import type { LanguageFn } from 'highlight.js';
import type { CodeLanguage } from '@voithos-labs/aragonite/plugin';
import { DEFAULT_LANGUAGES } from './default-languages';

/** A grammar or its module, as `import()` answers it. */
type Loaded = Promise<LanguageFn | { default: LanguageFn }>;

/** A grammar `languages` adds: the grammar itself, or a loader called the first time it's named. */
export type LanguageSource =
	| LanguageFn
	| {
			load(): Loaded;
			readonly aliases?: readonly string[];
	  };

/** Answers which grammar a language gets, and lists what it answers. */
export interface LanguageResolver {
	/** The grammar for a language in any spelling: now, once it loads (or its module), or null for
	 *  none. An editor asks once per language; a rejection leaves that language plain there. */
	resolve(name: string): LanguageFn | Loaded | null;
	/** Every language `resolve` answers, once each with its other spellings: the picker's rows, in
	 *  the picker's order. */
	readonly languages: readonly CodeLanguage[];
}

function createDefaultResolver(): LanguageResolver {
	const bySpelling = new Map(
		DEFAULT_LANGUAGES.flatMap((language) =>
			[language.name, ...language.aliases].map((spelling) => [spelling, language] as const)
		)
	);
	return {
		languages: DEFAULT_LANGUAGES.map(({ name, aliases }) => ({ name, aliases })),
		resolve(name) {
			const language = bySpelling.get(name.toLowerCase());
			if (!language) return null;
			return 'grammar' in language ? language.grammar : language.load();
		}
	};
}

/** The default languages: the eager set at once, the rest on demand. */
export const defaultResolver: LanguageResolver = createDefaultResolver();
