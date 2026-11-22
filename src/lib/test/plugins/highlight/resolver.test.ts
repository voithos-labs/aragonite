// The default resolver and the token reading, on highlight.js's own grammars.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import HighlightJS from 'highlight.js/lib/core';
import { defaultResolver } from '#packages/highlight/src/renderer/resolver.js';
import { tokensOf } from '#packages/highlight/src/renderer/tokens.js';

// A body per grammar and the runs the 0.11.5 core painted for it, as `class text` joined by ` | `.
const PAINTED_BY_0_11_5: [language: string, body: string, painted: string][] = [
	[
		'diff',
		'+ added\n- removed\n@@ -1 +1 @@',
		'added + added | removed - removed | meta @@ -1 +1 @@'
	],
	[
		'yaml',
		'key: value\nlist:\n  - 1\n  - "two" # c',
		'attr key: | string value | attr list: | punctuation - | number 1 | punctuation - | string "two" | comment # c'
	],
	[
		'json',
		'{"a": 1, "b": [true, null]}',
		'punctuation { | attr "a" | punctuation : | number 1 | punctuation , | attr "b" | punctuation : | punctuation [ | literal true | keyword true | punctuation , | literal null | keyword null | punctuation ] | punctuation }'
	],
	[
		'html',
		'<p class="x">hi &amp; bye</p>\n<!-- c -->',
		'punctuation <p class="x"> | type p | attr class | string "x" | symbol &amp; | punctuation </p> | type p | comment <!-- c -->'
	],
	['markdown', '## H2\n[link](http://x)', 'heading ## H2 | string link | link http://x'],
	['php', '<?php echo "x"; ?>', 'meta <?php | keyword echo | string "x" | meta ?>'],
	[
		'sql',
		'SELECT a FROM b WHERE c = 1;',
		'keyword SELECT | keyword FROM | keyword WHERE | operator = | number 1'
	],
	[
		'bash',
		'for i in 1 2; do echo $i; done',
		'keyword for | keyword in | keyword do | function echo | variable $i | keyword done'
	],
	[
		'java',
		'class A { int x = 1; }',
		'keyword class | function A | type int | variable x | operator = | number 1'
	]
];

// The languages 0.11.5's picker listed, in its order, `html` among them.
const ROWS_0_11_5 = [
	...['bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'html', 'java'],
	...['javascript', 'json', 'kotlin', 'latex', 'markdown', 'php', 'powershell', 'python', 'ruby'],
	...['rust', 'sql', 'swift', 'typescript', 'yaml']
];

const grammarOf = async (answer: unknown) => {
	const grammar = await answer;
	return (
		typeof grammar === 'function' ? grammar : (grammar as { default: unknown }).default
	) as never;
};

describe('the default resolver', () => {
	it('answers an eager grammar at once, under any spelling', () => {
		expect(typeof defaultResolver.resolve('JS')).toBe('function');
		expect(defaultResolver.resolve('shell')).toBe(defaultResolver.resolve('bash'));
		expect(defaultResolver.resolve('htm')).toBe(defaultResolver.resolve('html'));
	});

	it('answers any other grammar with a promise of it, under any spelling', async () => {
		const first = defaultResolver.resolve('rs');
		expect(typeof (first as Promise<unknown>).then).toBe('function');
		expect(await grammarOf(defaultResolver.resolve('rust'))).toBe(await grammarOf(first));
	});

	// Miss-analysis: the default set grew to every highlight.js grammar and no row said which
	// languages a default install lists, so the picker's 25 rows became 194 unnoticed.
	it("lists the 24 languages 0.11.5's picker listed, by its names and in its order", () => {
		expect(defaultResolver.languages.map((language) => language.name)).toEqual(ROWS_0_11_5);
	});

	it('knows no made-up name, and no grammar outside the default set', () => {
		expect(defaultResolver.resolve('no-such-language')).toBeNull();
		for (const name of ['nix', 'haskell', 'elixir', 'console', 'zig'])
			expect(defaultResolver.resolve(name), name).toBeNull();
	});

	// Miss-analysis: the core's 24 grammars left with their spelling test, so nothing held the
	// package to 0.11.5's spellings, which are the picker's search keys too, so the list is exact.
	it('answers exactly the spellings the core highlighted before the package', async () => {
		const spellings = [
			...['bash', 'sh', 'shell', 'c', 'cpp', 'c++', 'csharp', 'cs', 'c#', 'css', 'diff'],
			...['dockerfile', 'docker', 'go', 'html', 'htm', 'java', 'javascript', 'js', 'json'],
			...['kotlin', 'kt', 'latex', 'tex', 'markdown', 'md', 'php', 'powershell', 'ps1'],
			...['python', 'py', 'ruby', 'rust', 'rs', 'sql', 'swift', 'typescript', 'ts', 'yaml', 'yml']
		];
		const listed = defaultResolver.languages.flatMap((language) => [
			language.name,
			...(language.aliases ?? [])
		]);
		expect(listed.sort()).toEqual([...spellings].sort());
		for (const spelling of spellings)
			expect(typeof (await grammarOf(defaultResolver.resolve(spelling))), spelling).toBe(
				'function'
			);
		for (const spelling of ['tsx', 'jsx', 'xml', 'golang', 'zsh'])
			expect(defaultResolver.resolve(spelling), spelling).toBeNull();
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

	it('keeps a CRLF inside the one run that crosses it', () => {
		const hljs = HighlightJS.newInstance();
		hljs.registerLanguage('javascript', defaultResolver.resolve('js') as never);
		const body = 'const s = `a\r\nb`;';
		const runs = tokensOf(hljs, body, 'javascript').map((t) => body.slice(t.from, t.to));
		expect(runs).toContain('`a\r\nb`');
	});

	// Miss-analysis: the class map's own rows went with the core's grammars, and what was left named
	// four classes, so a scope moved to another colour stayed green.
	it.each(PAINTED_BY_0_11_5)('paints %s as 0.11.5 painted it', async (language, body, painted) => {
		const hljs = HighlightJS.newInstance();
		hljs.registerLanguage(language, await grammarOf(defaultResolver.resolve(language)));
		const runs = tokensOf(hljs, body, language).map(
			(t) => `${t.class.replace('code-tok-', '')} ${body.slice(t.from, t.to)}`
		);
		expect(runs.join(' | ')).toBe(painted);
	});

	// Miss-analysis: no row held two scopes over one range (JSON's `true` is a literal holding a
	// keyword), so which of them ends up inside, and colours the text, went unpinned.
	it('lists the outer of two scopes over one range first', () => {
		const hljs = HighlightJS.newInstance();
		hljs.registerLanguage('json', defaultResolver.resolve('json') as never);
		const body = '[true]';
		const runs = tokensOf(hljs, body, 'json').filter((t) => body.slice(t.from, t.to) === 'true');
		expect(runs.map((t) => t.class)).toEqual(['code-tok-literal', 'code-tok-keyword']);
	});

	it("maps highlight.js's scopes onto the theme's classes, an unmapped one to unknown", () => {
		const hljs = HighlightJS.newInstance();
		for (const name of ['css', 'markdown', 'javascript'])
			hljs.registerLanguage(name, defaultResolver.resolve(name) as never);
		const classes = (body: string, language: string) =>
			tokensOf(hljs, body, language).map((t) => `${body.slice(t.from, t.to)}:${t.class}`);
		expect(classes('a.b#c {}', 'css')).toEqual([
			'a:code-tok-type',
			'.b:code-tok-attr',
			'#c:code-tok-attr'
		]);
		expect(classes('# Title', 'markdown')).toEqual(['# Title:code-tok-heading']);
		expect(classes('x.y', 'javascript')).toEqual(['y:code-tok-unknown']);
	});
});
