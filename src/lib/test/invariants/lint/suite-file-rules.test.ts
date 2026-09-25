/**
 * File rules over the whole `src/lib` tree, tests included, for what `svelte-package` copies and
 * the gates read, and over the demo routes the e2e suite drives. This file sits inside its own
 * population, so every snippet a row must flag is assembled from parts. The scan is `file-rule.ts`.
 */

import { collectEditorSources, EDITOR_SRC, handRolledLexing, ROUTES_SRC } from './scan-source';
import { describeFileRules, under, type FileRule, type Probe } from './file-rule';

const at = (relPath: string, code: string): Probe => ({ relPath, code });

const quoted = (mark: string, text: string) => `${mark}${text}${mark}`;
const envRead = (separator: string) => ['import', 'meta', 'env'].join(separator);
const mockCall = (spec: string) => `vi.${'mock'}(${quoted("'", spec)}, () => ({}));`;
const spyCall = (mark: string, channel: string) =>
	`vi.spyOn(console, ${quoted(mark, channel)}).mockImplementation(() => {});`;
const clockRead = (host: string) => `const t = ${host}.now();`;
const depsField = (name: string) => `const deps = { ${name}: refSlotsOver(refs) };`;
const timerWait = (timer: string) => `await new Promise((r) => ${timer}(r));`;

const SUITE_DIRS = ['src/lib/test/', 'src/lib/e2e/'];
const PERF_DIRS = ['src/lib/test/perf/', 'src/lib/e2e/tests/perf/'];
const LINT_DIRS = ['src/lib/test/invariants/lint/', 'src/lib/e2e/lint/'];

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
				'main-thread responsiveness while a worker scan runs: elapsed time is the only signal, and a ratio cannot express it',
			'src/lib/e2e/editor-page.ts':
				'the harness arrival budget: the clock divides one ceiling between two waits, and asserts nothing about how long either took'
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
		id: 'a lint reads source through the shared lexer and collector',
		population: under(...LINT_DIRS),
		matches: (file) => handRolledLexing(file.code).length > 0,
		allowed: {
			'src/lib/test/invariants/lint/scan-source.ts': 'the shared lexer and collector',
			'src/lib/test/invariants/lint/comment-lines.ts':
				'the comment-block reader the budget and house-word scans share, which counts lines rather than blanking them',
			'src/lib/test/invariants/lint/spread-call-census.test.ts':
				'walks the classes lexicalClasses returns, so every character it tests is code',
			'src/lib/test/invariants/lint/consumer-guide-reserved-set.test.ts':
				'reads a printed `// Set {…}` line out of the guide’s example output, not a comment'
		},
		reason:
			'a private walk reads a bracket or quote inside a literal as code the day one appears (#287): use collectFiles, stripComments, walkCode or the helpers built on them in scan-source.ts',
		reaches: [
			'src/lib/test/invariants/lint/scan-source.ts',
			'src/lib/e2e/lint/composition-driver.test.ts'
		],
		hits: [
			at(
				`${LINT_DIRS[0]}a.test.ts`,
				`for (const ch of code) if (ch === ${quoted("'", '(')}) depth++;`
			),
			at(`${LINT_DIRS[1]}b.test.ts`, `const names = ${'readdir'}Sync(dir);`),
			at(`${LINT_DIRS[0]}c.test.ts`, `line.startsWith(${quoted("'", '/' + '/')});`)
		],
		misses: [
			at(
				`${LINT_DIRS[0]}a.test.ts`,
				`walkCode(code, 0, (ch) => {\n\tif (ch === ${quoted("'", '(')}) depth++;\n});`
			),
			at(`${LINT_DIRS[0]}d.test.ts`, `if (text[open] !== ${quoted("'", '(')}) return;`),
			at('src/lib/test/core/x.test.ts', `for (const ch of s) if (ch === ${quoted("'", '(')}) n++;`)
		]
	},
	{
		id: 'G4.4 no timing hacks for sequencing, in the unit suites too',
		population: under('src/lib/test/'),
		matches: /\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/,
		allowed: {
			'src/lib/test/invariants/lint/file-rules.test.ts':
				'the editor-side G4.4 row: its probe snippets are timer calls on purpose'
		},
		reason:
			'wait with settleEditor (test/harness/settle.ts), move a wall-clock timer with vi.useFakeTimers, or wait for real I/O with vi.waitFor; a macrotask flush also runs whatever unrelated timer is due, so a test can pass for the wrong reason',
		reaches: ['src/lib/test/harness/settle.ts'],
		hits: [
			at('src/lib/test/a.test.ts', timerWait(['set', 'Timeout'].join(''))),
			at('src/lib/test/b.test.ts', `${['queue', 'Microtask'].join('')}(() => {});`)
		],
		misses: [
			at('src/lib/test/c.test.ts', 'vi.advanceTimersByTime(250);\nawait settleEditor();'),
			at('src/lib/e2e/d.spec.ts', timerWait(['set', 'Timeout'].join('')))
		]
	},
	{
		id: 'one EditorActionsDeps builder for every suite',
		population: under('src/lib/test/', 'src/lib/testing/'),
		matches: /\bblockRefSlots\s*:/,
		allowed: {
			'src/lib/testing/headless-actions.ts':
				'the builder the kits and makeEditorActionsDeps share, with the document-aware selection and the real document write'
		},
		reason:
			'a hand-built EditorActionsDeps drifts from the editor: build one with createHeadlessActions, or makeEditorActionsDeps for spied collaborators',
		hits: [at('src/lib/test/a.test.ts', depsField(['block', 'RefSlots'].join('')))],
		misses: [at('src/lib/test/b.test.ts', depsField('refSlots'))]
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

const EDITOR_TAG = /<Editor\b/;

const ROUTE_RULES: FileRule[] = [
	{
		id: 'every route mounting an editor opts its document into the teardown parity walk',
		population: (file) => file.relPath.endsWith('.svelte'),
		matches: (file) => EDITOR_TAG.test(file.code) && !/\btrackParityDocument\s*\(/.test(file.code),
		reason:
			'the e2e fixture walks only the documents a route registered, so a route that forgets trackParityDocument gets no container-parity check at teardown and no error either',
		reaches: ['src/routes/+page.svelte'],
		atLeast: 10,
		hits: [at('src/routes/x/+page.svelte', `<Editor bind:this={editor} />`)],
		misses: [
			at(
				'src/routes/x/+page.svelte',
				`<script>trackParityDocument(() => editor);</script>\n<Editor bind:this={editor} />`
			),
			at('src/routes/x/+page.svelte', `<EditorToolbar />`)
		]
	}
];

describeFileRules(ROUTE_RULES, collectEditorSources(ROUTES_SRC, { includeTests: true }));
