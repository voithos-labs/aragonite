/** The measure script's counts: which import shapes reach a published symbol, and how lines and scans count. */
import { describe, it, expect } from 'vitest';
import {
	countLines,
	countScans,
	measureTree,
	workingTree
} from '../../../../../scripts/measure/measure.mjs';
import { checkBudgets } from '../../../../../scripts/pack/size-budget.mjs';

const PACKAGE = {
	name: '@voithos-labs/aragonite',
	exports: {
		'.': { svelte: './dist/index.js', default: './dist/prebuilt/index.js' },
		'./plugin': { svelte: './dist/plugin.js', default: './dist/prebuilt/plugin.js' },
		'./dev-checks': { 'aragonite-source': './src/lib/dev-checks.ts' }
	}
};

/** A library whose two entries publish `parse`, `Node`, `Kind`, `Row`, `picked`, and all of
 *  `star.ts`, `named.ts` and `spread.ts`. */
const LIBRARY: Record<string, string> = {
	'package.json': JSON.stringify(PACKAGE),
	'docs/design/invariants/scans.md': '',
	'src/lib/index.ts': [
		"export { parse } from './core/parser.js';",
		"export type { Node } from './core/nodes.js';",
		"export * from './star.js';",
		"export * as named from './named.js';",
		"import { rowOf } from './table/rows.svelte.js';",
		'export { rowOf as Row };'
	].join('\n'),
	'src/lib/plugin.ts': [
		"export { Kind as PluginKind } from './schema';",
		"export { picked } from './barrel.js';",
		"export { spreadNs } from './mid.js';"
	].join('\n'),
	'src/lib/mid.ts': "import * as spreadNs from './spread.js';\nexport { spreadNs };",
	'src/lib/spread.ts': 'export const spread = 1;',
	'src/lib/named.ts': 'export const fromNamed = 1;',
	'src/lib/barrel.ts': "export * from './many.js';",
	'src/lib/many.ts': 'export const picked = 1;\nexport const unpicked = 2;',
	'src/lib/schema/index.ts': "export { Kind, hidden } from './kinds.js';",
	'src/lib/schema/kinds.ts': 'export const Kind = 1;\nexport const hidden = 2;',
	'src/lib/core/parser.ts': 'export function parse() {}\nexport function internalStep() {}',
	'src/lib/core/nodes.ts': 'export type Node = {};\nexport type Hidden = {};',
	'src/lib/star.ts': "export * from './deep.js';",
	'src/lib/deep.ts': 'export const deep = 1;',
	'src/lib/table/rows.svelte.ts': 'export function rowOf() {}\nexport function cellOf() {}',
	'src/lib/dev-checks.ts': 'export const isDev = true;',
	'src/lib/test/harness/mount.ts': "import { internalStep } from '#lib/core/parser.js';",
	'src/lib/test/harness/clean.ts': "import { parse } from '#lib';",
	'src/lib/test/harness/Fixture.svelte':
		'<script lang="ts">\n\timport { cellOf } from \'#lib/table/rows.svelte.js\';\n</script>'
};

const unitTest = (name: string, source: string) => ({ [`src/lib/test/${name}.test.ts`]: source });

function measure(tests: Record<string, string>) {
	const files = { ...LIBRARY, ...tests };
	return measureTree({ files: Object.keys(files), read: (file: string) => files[file] });
}

/** Whether a unit test of this source counts as reaching only published symbols. */
function isPublishedOnly(source: string): boolean {
	const { tests } = measure(unitTest('probe', source));
	expect(tests.publishedOnly + tests.internal, 'the probe must import the library').toBe(1);
	return tests.publishedOnly === 1;
}

describe('measure: a unit test reaching only published symbols', () => {
	it.each([
		['an entry point, by alias', "import { parse } from '#lib';"],
		['a symbol where it is declared', "import { parse } from '#lib/core/parser.js';"],
		['a type re-exported as a type', "import type { Node } from '../core/nodes.js';"],
		['a file re-exported whole, two levels down', "import { deep } from '#lib/deep.js';"],
		['a renamed local re-export', "import { rowOf } from '#lib/table/rows.svelte.js';"],
		['a chain through a directory index', "import { Kind } from '#lib/schema/kinds.js';"],
		['a name picked through a barrel', "import { picked } from '#lib/many.js';"],
		['the package by name', "import { PluginKind } from '@voithos-labs/aragonite/plugin';"],
		['a file re-exported as a namespace', "import { fromNamed } from '#lib/named.js';"],
		['a namespace re-exported by name', "import { spread } from '#lib/spread.js';"],
		['a published-only helper', "import '../test/harness/clean.js';"]
	])('%s counts as published', (_, source) => {
		expect(isPublishedOnly(source)).toBe(true);
	});

	it.each([
		['an unpublished function', "import { internalStep } from '#lib/core/parser.js';"],
		['an unpublished type', "import type { Hidden } from '#lib/core/nodes.js';"],
		['a sibling of a published name', "import { hidden } from '#lib/schema/kinds.js';"],
		['a name a barrel holds but no entry picks', "import { unpicked } from '#lib/many.js';"],
		[
			'a namespace of a partly published file',
			"import * as rows from '#lib/table/rows.svelte.js';"
		],
		['a dynamic import of an internal file', "await import('#lib/core/parser.js');"],
		['a type naming an internal file', "type Parser = typeof import('#lib/core/parser.js');"],
		[
			'a mock of an internal file',
			"import { parse } from '#lib';\nvi.mock('#lib/core/parser.js');"
		],
		['a helper importing an internal', "import { mount } from './harness/mount.js';"],
		['a Svelte helper importing an internal', "import Fixture from './harness/Fixture.svelte';"]
	])('%s counts as internal', (_, source) => {
		expect(isPublishedOnly(source)).toBe(false);
	});

	it('the dev-checks self-import is neither published nor internal', () => {
		const { tests } = measure(
			unitTest('probe', "import { isDev } from '@voithos-labs/aragonite/dev-checks';")
		);
		expect(tests.noLibraryImport).toBe(1);
	});

	it('a helper is counted for every test reaching it, and only its tests own imports count as direct', () => {
		const { tests } = measure({
			...unitTest('a', "import './harness/mount.js';"),
			...unitTest('b', "import { parse } from '#lib/core/parser.js';\nimport './harness/mount.js';")
		});
		expect(tests.helpersImportingInternals).toEqual([
			{ helper: 'src/lib/test/harness/mount.ts', tests: 2 }
		]);
		expect(tests.internal).toBe(2);
		expect(tests.direct).toEqual({ internal: 0, publishedOnly: 1 });
		expect(tests.byModule.core).toEqual({
			internal: 2,
			publishedOnly: 0,
			internalDirect: 0,
			publishedOnlyDirect: 1
		});
	});
});

describe('measure: lines and scans', () => {
	it('splits code from comment lines, blank lines aside', () => {
		const source = [
			'// a line comment',
			'/** a block',
			' * comment */',
			'const a = 1; // trailing, so code',
			'',
			'/* one line */',
			'<!-- markup',
			'comment -->'
		].join('\n');
		expect(countLines(source, false)).toEqual({ code: 3, comment: 4 });
		expect(countLines(source, true)).toEqual({ code: 1, comment: 6 });
	});

	it('counts catalog rows, retired ones apart', () => {
		const catalog = [
			'| ID     | What stays true | Codes |',
			'| G4.1   | A rule          | L     |',
			'| G4.2   | _Retired_: held by G4.1 | L |',
			'| G4.3   | _Retired upward_: a type holds it | T |',
			'**G4.1 · A rule.** The entry, not a row.'
		].join('\n');
		expect(countScans(catalog)).toEqual({ active: 1, retired: 2 });
	});

	// Reading every file off the disk takes seconds under a full parallel run, past the default limit.
	it('reads the working tree: lines, every unit test file and the catalog', () => {
		const { lines, tests, scans } = measureTree(workingTree());
		expect(lines.code).toBeGreaterThan(10_000);
		expect(tests.files).toBeGreaterThan(1_000);
		expect(tests.publishedOnly).toBeGreaterThan(0);
		expect(scans.active).toBeGreaterThan(100);
	}, 30_000);
});

describe('size budget: checkBudgets', () => {
	const rows = { lines: { baseline: 100, tolerance: 5, unit: 'lines' } };

	it.each([
		[105, []],
		[95, []],
		[
			106,
			[
				'lines grew to 106 lines, 6 from its baseline 100 (tolerance 5); if the growth is on purpose, `bless` accepts it'
			]
		],
		[
			94,
			['lines shrank to 94 lines, 6 from its baseline 100 (tolerance 5); `bless` locks the gain in']
		]
	])('a value of %i against 100 ± 5', (value, failures) => {
		expect(checkBudgets({ lines: value }, rows, 'bless')).toEqual(failures);
	});

	it('a measured row with no baseline fails', () => {
		expect(checkBudgets({ other: 1 }, rows, 'bless')).toHaveLength(1);
	});
});
