import { describe, it, expect, beforeEach } from 'vitest';
import {
	bootstrapCodeLanguages,
	__resetBootForTests
} from '../../../components/blocks/code/code-bootstrap';
import {
	getLanguageGrammar,
	listLanguages,
	__resetRegistryForTests
} from '../../../components/blocks/code/code-languages';

/** Every built-in language and the spellings it answers to: canonical name first. */
const BUILT_IN: readonly (readonly string[])[] = [
	['bash', 'sh', 'shell'],
	['c'],
	['cpp', 'c++'],
	['csharp', 'cs', 'c#'],
	['css'],
	['diff'],
	['dockerfile', 'docker'],
	['go'],
	['html', 'htm'],
	['java'],
	['javascript', 'js'],
	['json'],
	['kotlin', 'kt'],
	['latex', 'tex'],
	['markdown', 'md'],
	['php'],
	['powershell', 'ps1'],
	['python', 'py'],
	['ruby'],
	['rust', 'rs'],
	['sql'],
	['swift'],
	['typescript', 'ts'],
	['yaml', 'yml']
];

describe('code-bootstrap', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
	});

	it('offers exactly the built-in languages, one entry each', () => {
		bootstrapCodeLanguages();

		expect(listLanguages()).toEqual([...BUILT_IN.map(([name]) => name)].sort());
	});

	it('resolves every built-in language from its name and from each of its aliases', () => {
		bootstrapCodeLanguages();

		for (const [name, ...aliases] of BUILT_IN) {
			for (const spelling of [name, ...aliases]) {
				expect(getLanguageGrammar(spelling)?.name, spelling).toBe(name);
			}
		}
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
