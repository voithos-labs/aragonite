import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerLanguage,
	getLanguageGrammar,
	getLanguageAliases,
	listLanguages,
	__resetRegistryForTests
} from '../../../components/blocks/code/code-languages';
import type { LanguageFn } from 'highlight.js';

const fakeGrammar = (() => ({ name: 'fake' })) as unknown as LanguageFn;

describe('code-languages registry', () => {
	beforeEach(() => {
		__resetRegistryForTests();
	});

	it('registers and resolves a language by name', () => {
		registerLanguage('javascript', fakeGrammar);
		const grammar = getLanguageGrammar('javascript');
		expect(grammar).not.toBeNull();
		expect(grammar?.name).toBe('javascript');
	});

	it('resolves via an alias', () => {
		registerLanguage('javascript', fakeGrammar, ['js']);
		expect(getLanguageGrammar('js')?.name).toBe('javascript');
	});

	it('is case insensitive', () => {
		registerLanguage('Python', fakeGrammar, ['Py']);
		expect(getLanguageGrammar('PYTHON')?.name).toBe('python');
		expect(getLanguageGrammar('PY')?.name).toBe('python');
	});

	it('returns null for empty info strings', () => {
		registerLanguage('javascript', fakeGrammar);
		expect(getLanguageGrammar('')).toBeNull();
		expect(getLanguageGrammar('   ')).toBeNull();
	});

	it('returns null for unknown info strings', () => {
		registerLanguage('javascript', fakeGrammar);
		expect(getLanguageGrammar('xyz')).toBeNull();
	});

	it('uses only the first whitespace-delimited token as the language key', () => {
		registerLanguage('javascript', fakeGrammar, ['js']);
		expect(getLanguageGrammar('js {1-3}')?.name).toBe('javascript');
		expect(getLanguageGrammar('javascript title="example"')?.name).toBe('javascript');
	});

	it('lists one entry per language — the canonical name, sorted, aliases folded away', () => {
		registerLanguage('Python', fakeGrammar, ['py']);
		registerLanguage('javascript', fakeGrammar, ['js', 'JS']);

		const listed = listLanguages();

		expect(listed).toEqual(['javascript', 'python']);
		for (const name of listed) expect(getLanguageGrammar(name)).not.toBeNull();
	});

	it('reports the spellings a language answers to, from either of them', () => {
		registerLanguage('Python', fakeGrammar, ['py', 'PY']);

		expect(getLanguageAliases('python')).toEqual(['py']);
		expect(getLanguageAliases('py')).toEqual(['py']);
	});

	it('reports no aliases for a language registered without any, or for an unknown name', () => {
		registerLanguage('go', fakeGrammar);

		expect(getLanguageAliases('go')).toEqual([]);
		expect(getLanguageAliases('klingon')).toEqual([]);
	});

	it('is idempotent — registering twice is a no-op', () => {
		const first = (() => ({ name: 'first' })) as unknown as LanguageFn;
		const second = (() => ({ name: 'second' })) as unknown as LanguageFn;
		registerLanguage('javascript', first);
		registerLanguage('javascript', second);
		expect(getLanguageGrammar('javascript')?.definition).toBe(first);
	});
});
