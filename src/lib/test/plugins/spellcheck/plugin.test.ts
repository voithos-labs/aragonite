import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spellcheckPlugin } from '#packages/spellcheck/src/index.js';

const manifest = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { version: string };

describe('spellcheckPlugin', () => {
	it('names its package’s version and the editor it releases with', () => {
		expect(spellcheckPlugin.name).toBe('spellcheck');
		expect(spellcheckPlugin.version).toBe(manifest('packages/spellcheck/package.json').version);
		expect(spellcheckPlugin.editor).toBe(manifest('package.json').version);
	});
});
