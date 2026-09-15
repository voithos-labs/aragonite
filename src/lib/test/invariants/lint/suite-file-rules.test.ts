/**
 * File rules over the whole `src/lib` tree, tests included, for what `svelte-package` copies and
 * the gates read. This file sits inside its own population, so every snippet a row must flag is
 * assembled from parts rather than written out. The scan is `file-rule.ts`.
 */

import { collectEditorSources, EDITOR_SRC } from './scan-source';
import { describeFileRules, under, type FileRule, type Probe } from './file-rule';

const at = (relPath: string, code: string): Probe => ({ relPath, code });

const quoted = (mark: string, text: string) => `${mark}${text}${mark}`;
const envRead = (separator: string) => ['import', 'meta', 'env'].join(separator);
const mockCall = (spec: string) => `vi.${'mock'}(${quoted("'", spec)}, () => ({}));`;
const spyCall = (mark: string, channel: string) =>
	`vi.spyOn(console, ${quoted(mark, channel)}).mockImplementation(() => {});`;
const clockRead = (host: string) => `const t = ${host}.now();`;

const SUITE_DIRS = ['src/lib/test/', 'src/lib/e2e/'];
const PERF_DIRS = ['src/lib/test/perf/', 'src/lib/e2e/tests/perf/'];

/** One test file and one library file, so a walk that lost either half reads as unreached. */
const BOTH_HALVES = ['src/lib/index.ts', 'src/lib/test/invariants/lint/scan-source.ts'];

const RULES: FileRule[] = [
	{
		id: 'G4.25 no `import.meta` env read anywhere under src/lib',
		matches: /import\s*\.\s*meta\s*\.\s*env\b/,
		reason:
			'the env object is a Vite-only extension: outside a Vite bundle a module-scope read throws at import time; toolchain flags come from esm-env',
		reaches: BOTH_HALVES,
		hits: [`if (${envRead('.')}.DEV) x();`, `const m = ${envRead(' . ')};`],
		misses: ['new URL("./x.json", import.meta.url);\nimport { DEV } from "esm-env";']
	},
	{
		id: 'G4.41 no file mocks dev-warn',
		matches: /vi\s*\.\s*mock\(\s*['"`][^'"`]*dev-warn['"`]/,
		reason:
			'a mocked devWarn never reaches the sink, so every guard fire in the file is invisible to the gate: assert on takeDevWarns() or declare the tag with allowDevWarns',
		reaches: BOTH_HALVES,
		hits: [mockCall('$lib/dev-warn'), mockCall('../../dev-warn')],
		misses: [mockCall('esm-env')]
	},
	{
		id: 'G4.41 the console.warn spies are exactly the files that pin a warning channel',
		matches: /spyOn\(\s*console\s*,\s*['"`]warn['"`]\s*\)/,
		allowed: {
			'src/lib/test/dev-warn.test.ts':
				'pins devWarn’s console output: the exact line shape the e2e watchers key on'
		},
		reason:
			'a registered sink takes reporting over, so a console spy sees nothing a dev warning wrote, and one that swallows the call hides every Svelte runtime warning from the gate',
		hits: [spyCall("'", 'warn'), spyCall('`', 'warn')],
		misses: [spyCall("'", 'error')]
	},
	{
		id: 'G4.48 wall-clock budgets outside the perf projects go through the growth harness',
		population: (file) =>
			SUITE_DIRS.some((dir) => file.relPath.startsWith(dir)) && !under(...PERF_DIRS)(file),
		matches: /\b(?:performance\.now|Date\.now)\s*\(/,
		allowed: {
			'src/lib/test/harness/scan-growth.ts':
				'the ratio harness: the clock reads that replace budgets',
			'src/lib/test/core/inline/scan/gfm-autolinks.test.ts':
				'deep-nesting overflow guard: the bound is recursion depth, not scan length, so no N-vs-4N pair can price it',
			'src/lib/e2e/tests/search/pathological-regex.spec.ts':
				'main-thread responsiveness while a worker scan runs: elapsed time is the only signal, and a ratio cannot express it'
		},
		reason:
			'a millisecond ceiling measures the machine; price the scan as a measureScanGrowth ratio, or allowlist the file with the reason no ratio carries its claim',
		hits: [
			at('src/lib/test/a.test.ts', clockRead('performance')),
			at('src/lib/e2e/b.test.ts', clockRead('Date'))
		],
		misses: [
			at('src/lib/test/c.test.ts', '   '),
			at('src/lib/e2e/tests/perf/x.perf.spec.ts', clockRead('performance')),
			at('src/lib/test/perf/y.bench.ts', clockRead('performance'))
		]
	},
	{
		id: 'no inline block-content selector in e2e specs',
		population: under('src/lib/e2e/tests/'),
		matches: /:not\(\s*\.selection-overlay\s*\)/,
		reason:
			'route block-content lookups through BLOCK_CONTENT_SELECTOR (re-exported from editor-page) or a page-object helper; an inline copy never excludes .decoration-badge',
		hits: [
			at(
				'src/lib/e2e/tests/x.spec.ts',
				"wrapper.querySelector(':scope > :not(.selection-overlay)')"
			),
			at('src/lib/e2e/tests/x.spec.ts', "querySelector(':not( .selection-overlay )')")
		],
		misses: [
			at(
				'src/lib/e2e/tests/x.spec.ts',
				"page.locator('.selection-overlay')\n" +
					"page.locator('.selection-overlay-endpoint')\n" +
					'wrapper.querySelector(BLOCK_CONTENT_SELECTOR)'
			)
		]
	}
];

describeFileRules(RULES, collectEditorSources(EDITOR_SRC, { includeTests: true }));
