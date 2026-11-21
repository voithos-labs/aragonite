// The default resolver and the token reading, on highlight.js's own grammars.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import HighlightJS from 'highlight.js/lib/core';
import { defaultResolver } from '#packages/highlight/src/renderer/resolver.js';
import { tokensOf } from '#packages/highlight/src/renderer/tokens.js';

describe('the default resolver', () => {
	it('answers an eager grammar at once, under any spelling', () => {
		expect(typeof defaultResolver.resolve('JS')).toBe('function');
		expect(defaultResolver.resolve('shell')).toBe(defaultResolver.resolve('bash'));
		expect(defaultResolver.resolve('htm')).toBe(defaultResolver.resolve('html'));
	});

	it('answers any other grammar with one promise, then at once', async () => {
		const first = defaultResolver.resolve('golang');
		expect(typeof (first as Promise<unknown>).then).toBe('function');
		expect(defaultResolver.resolve('go')).toBe(first);
		const grammar = await first;
		expect(defaultResolver.resolve('go')).toBe(grammar);
	});

	it('lists each grammar once, each spelling under one name', () => {
		const names = defaultResolver.languages.map((language) => language.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain('xml');
		expect(names).toContain('console');
		expect(names).not.toContain('html');
		expect(names).not.toContain('shell');
		expect(names.length).toBeGreaterThan(190);
	});

	it('knows no made-up name', () => {
		expect(defaultResolver.resolve('no-such-language')).toBeNull();
	});
});

describe('the catalog', () => {
	it("matches highlight.js's grammar files", () => {
		const run = spawnSync(process.execPath, ['packages/highlight/scripts/catalog.mjs', '--check'], {
			timeout: 60_000,
			encoding: 'utf8'
		});
		expect(run.stderr).toBe('');
		expect(run.status).toBe(0);
	});
});

describe('tokensOf', () => {
	it('reads nested runs over the body, CRLF included', () => {
		const hljs = HighlightJS.newInstance();
		hljs.registerLanguage('javascript', defaultResolver.resolve('js') as never);
		const body = 'const a = "<&>";\r\n// done';
		const tokens = tokensOf(hljs, body, 'javascript');
		const text = (t: { from: number; to: number }) => body.slice(t.from, t.to);
		expect(tokens.map((t) => [text(t), t.class])).toEqual([
			['const', 'code-tok-keyword'],
			['"<&>"', 'code-tok-string'],
			['// done', 'code-tok-comment']
		]);
	});
});
