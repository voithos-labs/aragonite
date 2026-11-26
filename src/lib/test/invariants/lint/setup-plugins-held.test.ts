// G4.407: the repo's pages and examples list plugin values. Each `setup` plugin left tests a
// published `setup` surface no value stands in for, so they are named here and nothing joins them
// unseen. A file that drops its last one leaves the list; a file that gains one fails.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectFiles, sourceFile, walkCode } from './scan-source';
import { ignoredPaths, isIgnoredBy } from '../../../../../scripts/docs/doc-corpus.mjs';

/** The files that define a `setup` plugin, and how many each defines. */
const HELD: Readonly<Record<string, number>> = {
	// Only a setup plugin may augment a built-in, and only one whose setup throws leaves a kind
	// registered with no view: the list-throw and orphan probes.
	'src/routes/test/editor/test-probes.ts': 2,
	'src/routes/test/plugins/block-badge/block-badge-plugin.ts': 1,
	'src/routes/test/plugins/callout/register.ts': 1,
	'src/routes/test/plugins/chips/chip-plugin.ts': 1,
	'src/routes/test/plugins/doc-stats/doc-stats-plugin.ts': 1,
	'src/routes/test/plugins/fold/fold-plugin.ts': 1,
	'src/routes/test/plugins/ghost-text/ghost-text-plugin.ts': 1,
	'src/routes/test/plugins/memo/register.ts': 1,
	'src/routes/test/plugins/sim-island/sim-island-plugin.ts': 1,
	'src/routes/test/plugins/sim-mark/sim-mark-plugin.ts': 1,
	'src/routes/test/plugins/tags/tag-plugin.ts': 1,
	'examples/vue/src/SharedPlugin.vue': 1
};
const HELD_FILES = Object.keys(HELD);

/** The pages that list one of the held plugins defined in another file. */
const PAGES: readonly string[] = [
	'src/routes/test/plugins/+page.svelte',
	'src/routes/test/plugins/activation/+page.svelte',
	'src/routes/test/plugins/multi/+page.svelte',
	'src/routes/test/plugins/staggered/+page.svelte'
];

const ROOTS = ['src/routes', 'examples'];
const SKIP = ['node_modules', '.svelte-kit', 'dist', 'build', '.next', '.nuxt', '.output'];

function sources() {
	const ignored = ignoredPaths(ROOTS);
	return ROOTS.flatMap((root) =>
		collectFiles(root, { extensions: ['.ts', '.tsx', '.svelte', '.vue'], skip: SKIP })
	)
		.filter((relPath) => !isIgnoredBy(ignored, relPath))
		.map((relPath) => sourceFile(relPath, readFileSync(path.resolve(relPath), 'utf8')));
}

/** How many `definePlugin({ ... })` calls in `code` hand it no `contributes`: a `setup` plugin. */
export function setupPluginCount(code: string): number {
	let count = 0;
	for (const call of code.matchAll(/\bdefinePlugin\s*(?:<[^>()]*>)?\(\s*\{/g)) {
		let depth = 1;
		const end = walkCode(code, call.index + call[0].length, (ch) => {
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			return depth === 0;
		});
		if (!/\bcontributes\b/.test(code.slice(call.index, end))) count++;
	}
	return count;
}

const HELD_MODULE = new RegExp(
	`from\\s+['"][^'"]*(?:${HELD_FILES.filter((file) => file.startsWith('src/routes/test/plugins/'))
		.map((file) => file.replace(/^src\/routes\/test\/plugins\//, '').replace(/\.ts$/, ''))
		.join('|')})['"]`
);

describe('G4.407 the setup plugins left are the held ones', () => {
	const files = sources();

	// Miss-analysis (G4.369's): a list of files alone let a second one into a listed file.
	it('are defined only in the files listed, no more often than listed', () => {
		const defined = Object.fromEntries(
			files
				.map((file) => [file.relPath, setupPluginCount(file.code)] as const)
				.filter(([, count]) => count > 0)
		);
		expect(
			defined,
			'a page or example lists a plugin value (`definePlugin({ contributes })`); a file that no longer defines a setup plugin leaves HELD'
		).toEqual(HELD);
	});

	it('are listed only on the pages named', () => {
		const listing = files
			.filter((file) => !(file.relPath in HELD) && HELD_MODULE.test(file.code))
			.map((file) => file.relPath);
		expect(listing.sort()).toEqual([...PAGES].sort());
	});

	// Vacuity guard: a detector that found nothing would pass the first row whatever the tree held.
	it('tells a setup plugin from a plugin value', () => {
		expect(setupPluginCount("definePlugin({ name: 'a', setup() {} })")).toBe(1);
		expect(
			setupPluginCount(
				"definePlugin<O>({ name: 'a', version: '1', editor: '*', contributes: () => ({ setup() {} }) })"
			)
		).toBe(0);
	});
});
