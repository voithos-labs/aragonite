/**
 * The languages an editor highlights by default, under the names the picker shows and the spellings
 * documents already use. Eight load with the page, the rest the first time a fence names one. Every
 * other grammar is the opt-in's (`all-languages.ts`). A spelling added here is a search key that
 * changes what the picker's filter finds and what its Enter writes.
 */
import type { LanguageFn } from 'highlight.js';
import type { CodeLanguage } from '@voithos-labs/aragonite/plugin';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

type Load = () => Promise<{ default: LanguageFn }>;

/** A default language with its grammar in hand, or the loader of its chunk. */
export type DefaultLanguage = CodeLanguage & {
	readonly aliases: readonly string[];
	/** highlight.js's name for the grammar, where the picker's row reads otherwise. */
	readonly file?: string;
} & ({ readonly grammar: LanguageFn } | { readonly load: Load });

/** In the picker's order. */
export const DEFAULT_LANGUAGES: readonly DefaultLanguage[] = [
	// highlight.js reads `shell` as a shell session (prompts); GitHub reads a script, as this does.
	{ name: 'bash', aliases: ['sh', 'shell'], grammar: bash },
	{ name: 'c', aliases: [], load: () => import('highlight.js/lib/languages/c') },
	{ name: 'cpp', aliases: ['c++'], load: () => import('highlight.js/lib/languages/cpp') },
	{
		name: 'csharp',
		aliases: ['cs', 'c#'],
		load: () => import('highlight.js/lib/languages/csharp')
	},
	{ name: 'css', aliases: [], grammar: css },
	{ name: 'diff', aliases: [], load: () => import('highlight.js/lib/languages/diff') },
	{
		name: 'dockerfile',
		aliases: ['docker'],
		load: () => import('highlight.js/lib/languages/dockerfile')
	},
	{ name: 'go', aliases: [], load: () => import('highlight.js/lib/languages/go') },
	// highlight.js calls the grammar `xml` and knows no `htm`.
	{ name: 'html', file: 'xml', aliases: ['htm'], grammar: xml },
	{ name: 'java', aliases: [], load: () => import('highlight.js/lib/languages/java') },
	{ name: 'javascript', aliases: ['js'], grammar: javascript },
	{ name: 'json', aliases: [], grammar: json },
	{ name: 'kotlin', aliases: ['kt'], load: () => import('highlight.js/lib/languages/kotlin') },
	{ name: 'latex', aliases: ['tex'], load: () => import('highlight.js/lib/languages/latex') },
	{ name: 'markdown', aliases: ['md'], grammar: markdown },
	{ name: 'php', aliases: [], load: () => import('highlight.js/lib/languages/php') },
	{
		name: 'powershell',
		aliases: ['ps1'],
		load: () => import('highlight.js/lib/languages/powershell')
	},
	{ name: 'python', aliases: ['py'], grammar: python },
	{ name: 'ruby', aliases: [], load: () => import('highlight.js/lib/languages/ruby') },
	{ name: 'rust', aliases: ['rs'], load: () => import('highlight.js/lib/languages/rust') },
	{ name: 'sql', aliases: [], load: () => import('highlight.js/lib/languages/sql') },
	{ name: 'swift', aliases: [], load: () => import('highlight.js/lib/languages/swift') },
	{ name: 'typescript', aliases: ['ts'], grammar: typescript },
	{ name: 'yaml', aliases: ['yml'], load: () => import('highlight.js/lib/languages/yaml') }
];
