import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapCodeLanguages } from '../../../components/blocks/code/code-bootstrap';
import { getLanguageGrammar, listLanguages } from '../../../components/blocks/code/code-languages';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

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
		__resetSchemaRegistriesForTests();
	});

	it('offers exactly the built-in languages, one entry each', () => {
		bootstrapCodeLanguages();

		expect(listLanguages(everyInstalledPlugin)).toEqual([...BUILT_IN.map(([name]) => name)].sort());
	});

	it('resolves every built-in language from its name and from each of its aliases', () => {
		bootstrapCodeLanguages();

		for (const [name, ...aliases] of BUILT_IN) {
			for (const spelling of [name, ...aliases]) {
				expect(getLanguageGrammar(spelling, everyInstalledPlugin)?.name, spelling).toBe(name);
			}
		}
	});

	it('is idempotent across multiple calls', () => {
		bootstrapCodeLanguages();
		bootstrapCodeLanguages();
		bootstrapCodeLanguages();
		expect(getLanguageGrammar('javascript', everyInstalledPlugin)?.name).toBe('javascript');
	});

	it('returns null for unknown languages', () => {
		bootstrapCodeLanguages();
		expect(getLanguageGrammar('klingon', everyInstalledPlugin)).toBeNull();
		expect(getLanguageGrammar('', everyInstalledPlugin)).toBeNull();
	});
});
