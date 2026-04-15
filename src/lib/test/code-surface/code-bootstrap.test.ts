import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapCodeLanguages, __resetBootForTests } from '../../code-surface/code-bootstrap';
import { getLanguageGrammar, __resetRegistryForTests } from '../../code-surface/code-languages';

describe('code-bootstrap', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
	});

	it('registers all 11 Tier 1 languages', () => {
		bootstrapCodeLanguages();
		for (const name of [
			'javascript',
			'typescript',
			'python',
			'rust',
			'go',
			'bash',
			'json',
			'yaml',
			'sql',
			'html',
			'css'
		]) {
			expect(getLanguageGrammar(name)).not.toBeNull();
		}
	});

	it('registers all 6 Tier 2 languages', () => {
		bootstrapCodeLanguages();
		for (const name of ['java', 'c', 'cpp', 'ruby', 'markdown', 'diff']) {
			expect(getLanguageGrammar(name)).not.toBeNull();
		}
	});

	it('registers aliases', () => {
		bootstrapCodeLanguages();
		expect(getLanguageGrammar('js')?.name).toBe('javascript');
		expect(getLanguageGrammar('ts')?.name).toBe('typescript');
		expect(getLanguageGrammar('py')?.name).toBe('python');
		expect(getLanguageGrammar('rs')?.name).toBe('rust');
		expect(getLanguageGrammar('sh')?.name).toBe('bash');
		expect(getLanguageGrammar('shell')?.name).toBe('bash');
		expect(getLanguageGrammar('yml')?.name).toBe('yaml');
		expect(getLanguageGrammar('htm')?.name).toBe('html');
		expect(getLanguageGrammar('c++')?.name).toBe('cpp');
		expect(getLanguageGrammar('md')?.name).toBe('markdown');
	});

	it('is idempotent across multiple calls', () => {
		bootstrapCodeLanguages();
		bootstrapCodeLanguages();
		bootstrapCodeLanguages();
		expect(getLanguageGrammar('javascript')?.name).toBe('javascript');
	});

	it('returns null for unknown languages', () => {
		bootstrapCodeLanguages();
		expect(getLanguageGrammar('klingon')).toBeNull();
		expect(getLanguageGrammar('')).toBeNull();
	});
});
