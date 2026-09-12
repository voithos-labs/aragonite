import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerLanguage,
	getLanguageGrammar,
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

	it('lists every name and alias once, sorted, and each listed entry resolves', () => {
		registerLanguage('Python', fakeGrammar, ['py']);
		registerLanguage('javascript', fakeGrammar, ['js', 'JS']);

		const listed = listLanguages();

		expect(listed).toEqual(['javascript', 'js', 'py', 'python']);
		for (const name of listed) expect(getLanguageGrammar(name)).not.toBeNull();
	});

	it('is idempotent — registering twice is a no-op', () => {
		const first = (() => ({ name: 'first' })) as unknown as LanguageFn;
		const second = (() => ({ name: 'second' })) as unknown as LanguageFn;
		registerLanguage('javascript', first);
		registerLanguage('javascript', second);
		expect(getLanguageGrammar('javascript')?.definition).toBe(first);
	});
});
