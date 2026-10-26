/**
 * The types gate verify-pack runs over `dist` (G4.185), driven here over a small declaration tree:
 * every import shape that can carry `svelte` or a stylesheet into a host's type-check is caught,
 * however deep, and the Svelte entry alone may reach `svelte`.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { typeLeaks, verifyTypes } from '../../../../../scripts/pack/verify-types.mjs';

let root = '';

function write(files: Record<string, string>): void {
	root = mkdtempSync(path.join(tmpdir(), 'types-gate-'));
	for (const [rel, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		writeFileSync(path.join(root, rel), text);
	}
}

const leaksFrom = (entry: string) =>
	typeLeaks(path.join(root, entry)).map(
		({ specifier, chain }) => `${specifier} @ ${chain.join(' > ')}`
	);

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('G4.185 published types reach no svelte import and no stylesheet', () => {
	it.each([
		['a named import', "import type { Snippet } from 'svelte';"],
		['a subpath import', "import type { Attachment } from 'svelte/attachments';"],
		['an inline import type', "export declare const x: import('svelte').Component;"],
		['a re-export', "export { mount } from 'svelte';"]
	])('catches %s of svelte two files down', (_shape, line) => {
		write({
			'index.d.ts': "export * from './a.js';",
			'a.d.ts': "import type { B } from './b';\nexport type A = B;",
			'b.d.ts': `${line}\nexport type B = string;`
		});
		expect(leaksFrom('index.d.ts')).toEqual([
			`${/'(svelte[^']*)'/.exec(line)![1]} @ index.d.ts > a.d.ts > b.d.ts`
		]);
	});

	it('catches a side-effect stylesheet import, relative or from a package', () => {
		write({
			'index.d.ts': "import './x.css';\nimport 'katex/dist/katex.min.css';\nexport {};"
		});
		expect(leaksFrom('index.d.ts')).toEqual([
			'./x.css @ index.d.ts',
			'katex/dist/katex.min.css @ index.d.ts'
		]);
	});

	it('catches a triple-slash types reference, and follows a path one', () => {
		write({
			'index.d.ts': '/// <reference path="./a.d.ts" />\nexport {};',
			'a.d.ts': '/// <reference types="svelte" />\nexport {};'
		});
		expect(leaksFrom('index.d.ts')).toEqual(['svelte @ index.d.ts > a.d.ts']);
	});

	it('follows a component declaration and a directory index', () => {
		write({
			'index.d.ts': "export { default as W } from './W.svelte';\nexport * from './dir';",
			'W.svelte.d.ts': "import { SvelteComponent } from 'svelte';",
			'dir/index.d.ts': 'export type D = 1;'
		});
		expect(leaksFrom('index.d.ts')).toEqual(['svelte @ index.d.ts > W.svelte.d.ts']);
	});

	it('ignores comments, string types and other packages', () => {
		write({
			'index.d.ts': [
				"/** import { Editor } from 'svelte' */",
				"// import 'x.css';",
				"export declare const LINK: '.md-link';",
				"import type { LanguageFn } from 'highlight.js';"
			].join('\n')
		});
		expect(leaksFrom('index.d.ts')).toEqual([]);
	});

	it('reports a relative import no declaration answers', () => {
		write({ 'index.d.ts': "export * from './gone.js';" });
		expect(leaksFrom('index.d.ts')).toEqual(['./gone.js (no declaration file) @ index.d.ts']);
	});

	it('exempts only the Svelte entry, and fails it if it reaches no svelte at all', () => {
		const exports = {
			'.': { types: './dist/index.d.ts' },
			'./svelte': { types: './dist/svelte.d.ts' }
		};
		write({
			'package.json': JSON.stringify({ exports }),
			'dist/index.d.ts': "import type { Snippet } from 'svelte';",
			'dist/svelte.d.ts': 'export {};'
		});
		expect(verifyTypes(root)).toEqual([
			'. reaches svelte through index.d.ts',
			'./svelte reaches no svelte import, so the walk over its types is blind'
		]);
	});
});
