import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerLanguage,
	getLanguageGrammar,
	getLanguageAliases,
	listLanguages
} from '../../../components/blocks/code/code-languages';
import type { LanguageFn } from 'highlight.js';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

const fakeGrammar = (() => ({ name: 'fake' })) as unknown as LanguageFn;

describe('code-languages registry', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
	});

	it('registers and resolves a language by name', () => {
		registerLanguage('javascript', fakeGrammar);
		const grammar = getLanguageGrammar('javascript', everyInstalledPlugin);
		expect(grammar).not.toBeNull();
		expect(grammar?.name).toBe('javascript');
	});

	it('resolves via an alias', () => {
		registerLanguage('javascript', fakeGrammar, ['js']);
		expect(getLanguageGrammar('js', everyInstalledPlugin)?.name).toBe('javascript');
	});

	it('is case insensitive', () => {
		registerLanguage('Python', fakeGrammar, ['Py']);
		expect(getLanguageGrammar('PYTHON', everyInstalledPlugin)?.name).toBe('python');
		expect(getLanguageGrammar('PY', everyInstalledPlugin)?.name).toBe('python');
	});

	it('returns null for empty info strings', () => {
		registerLanguage('javascript', fakeGrammar);
		expect(getLanguageGrammar('', everyInstalledPlugin)).toBeNull();
		expect(getLanguageGrammar('   ', everyInstalledPlugin)).toBeNull();
	});

	it('returns null for unknown info strings', () => {
		registerLanguage('javascript', fakeGrammar);
		expect(getLanguageGrammar('xyz', everyInstalledPlugin)).toBeNull();
	});

	it('uses only the first whitespace-delimited token as the language key', () => {
		registerLanguage('javascript', fakeGrammar, ['js']);
		expect(getLanguageGrammar('js {1-3}', everyInstalledPlugin)?.name).toBe('javascript');
		expect(getLanguageGrammar('javascript title="example"', everyInstalledPlugin)?.name).toBe(
			'javascript'
		);
	});

	it('lists one entry per language: the canonical name, sorted, aliases folded away', () => {
		registerLanguage('Python', fakeGrammar, ['py']);
		registerLanguage('javascript', fakeGrammar, ['js', 'JS']);

		const listed = listLanguages(everyInstalledPlugin);

		expect(listed).toEqual(['javascript', 'python']);
		for (const name of listed)
			expect(getLanguageGrammar(name, everyInstalledPlugin)).not.toBeNull();
	});

	it('reports the spellings a language answers to, from any spelling of it', () => {
		registerLanguage('Python', fakeGrammar, ['py', 'PY']);

		expect(getLanguageAliases('python', everyInstalledPlugin)).toEqual(['py']);
		expect(getLanguageAliases('py', everyInstalledPlugin)).toEqual(['py']);
	});

	// A host registers what it likes, and a name it picks can already be somebody's alias. The
	// name it was registered under wins: a grammar is never hidden behind another's nickname.
	it('resolves a name of its own over another language’s alias', () => {
		const hostGrammar = (() => ({ name: 'host' })) as unknown as LanguageFn;
		registerLanguage('bash', fakeGrammar, ['sh', 'shell']);
		registerLanguage('shell', hostGrammar);

		expect(getLanguageGrammar('shell', everyInstalledPlugin)?.definition).toBe(hostGrammar);
		expect(getLanguageGrammar('sh', everyInstalledPlugin)?.name).toBe('bash');
	});

	it('keeps a language’s own aliases when a later one takes its name as an alias', () => {
		registerLanguage('rust', fakeGrammar, ['rs']);
		registerLanguage('mylang', fakeGrammar, ['rust']);

		expect(getLanguageAliases('rust', everyInstalledPlugin)).toEqual(['rs']);
		expect(getLanguageGrammar('rust', everyInstalledPlugin)?.name).toBe('rust');
	});

	it('reports no aliases for a language registered without any, or for an unknown name', () => {
		registerLanguage('go', fakeGrammar);

		expect(getLanguageAliases('go', everyInstalledPlugin)).toEqual([]);
		expect(getLanguageAliases('klingon', everyInstalledPlugin)).toEqual([]);
	});

	it('is register-once: a taken name throws and keeps the first grammar', () => {
		const first = (() => ({ name: 'first' })) as unknown as LanguageFn;
		const second = (() => ({ name: 'second' })) as unknown as LanguageFn;
		registerLanguage('javascript', first);
		expect(() => registerLanguage('JavaScript', second)).toThrow(/already registered/);
		expect(getLanguageGrammar('javascript', everyInstalledPlugin)?.definition).toBe(first);
	});
});
