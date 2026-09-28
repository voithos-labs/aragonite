/**
 * File rules over the whole `src/lib` tree, tests included, for what `svelte-package` copies and
 * the gates read, and over the demo routes the e2e suite drives. This file sits inside its own
 * population, so every snippet a row must flag is assembled from parts. The scan is `file-rule.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	callsTo,
	collectEditorSources,
	EDITOR_SRC,
	handRolledLexing,
	balancedRegion,
	literalSpans,
	ROUTES_SRC,
	walkCode,
	type SourceFile
} from './scan-source';
import {
	describeFileRules,
	notUnder,
	probeFile,
	under,
	type FileRule,
	type Probe
} from './file-rule';

const at = (relPath: string, code: string): Probe => ({ relPath, code });

const quoted = (mark: string, text: string) => `${mark}${text}${mark}`;
const envRead = (separator: string) => ['import', 'meta', 'env'].join(separator);
const mockCall = (spec: string) => `vi.${'mock'}(${quoted("'", spec)}, () => ({}));`;
const spyCall = (mark: string, channel: string) =>
	`vi.spyOn(console, ${quoted(mark, channel)}).mockImplementation(() => {});`;
const clockRead = (host: string) => `const t = ${host}.now();`;
const depsField = (name: string) => `const deps = { ${name}: refSlotsOver(refs) };`;
const timerWait = (timer: string) => `await new Promise((r) => ${timer}(r));`;

const HOOKS = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
const PUBLIC_RESET = ['reset', 'PluginPlatformForTests'].join('');
const SCHEMA_RESET = ['__reset', 'SchemaRegistriesForTests'].join('');
const SOURCES = collectEditorSources(EDITOR_SRC, { includeTests: true });

/** The resets library modules enroll by name into the plugin platform reset, so one enrolled
 *  later joins the scan below with no edit here. */
function enrolledResets(sources: SourceFile[]): string[] {
	return sources
		.filter(notUnder('src/lib/test/'))
		.flatMap((file) => callsTo(file.code, 'enrollTestReset'))
		.map((arg) => arg.trim())
		.filter((arg) => /^[\w$]+$/.test(arg));
}

const RESET_NAMES = [PUBLIC_RESET, SCHEMA_RESET, ...enrolledResets(SOURCES)];
const namesPattern = (names: string[]) => new RegExp(`\\b(?:${names.join('|')})\\b`);
const PLATFORM_RESET = namesPattern(RESET_NAMES);
const resetCall = (name: string) => `${name}();`;

/** Local names an import gives a reset (`import { x as y }`). */
function resetAliases(code: string): string[] {
	return [...code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)].flatMap((m) =>
		m[1].split(',').flatMap((part) => {
			const [name, alias] = part.trim().split(/\s+as\s+/);
			return alias !== undefined && RESET_NAMES.includes(name) ? [alias] : [];
		})
	);
}

/** An arrow function's expression body, from `at` to the end of its statement. */
function arrowExpression(code: string, at: number): string {
	let depth = 0;
	const end = walkCode(code, at, (ch) => {
		if ('([{'.includes(ch)) depth++;
		else if (')]}'.includes(ch)) return --depth < 0;
		else if (depth === 0) return ch === ';' || ch === '\n';
	});
	return code.slice(at, end);
}

/** The file's own named functions, declared or arrow-bound, each with its body. */
function localFunctions(code: string): { name: string; body: string }[] {
	const declared = [...code.matchAll(/function\s+([\w$]+)\s*\([^)]*\)[^{]*\{/g)].map((m) => ({
		name: m[1],
		body: balancedBlock(code, m.index + m[0].length) ?? ''
	}));
	const bound = [
		...code.matchAll(
			/(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]*)?=>\s*/g
		)
	].map((m) => {
		const at = m.index + m[0].length;
		const body = code[at] === '{' ? (balancedBlock(code, at + 1) ?? '') : arrowExpression(code, at);
		return { name: m[1], body };
	});
	return [...declared, ...bound];
}

/** Hook arguments that reset the plugin platform: a reset name, an alias of one, or a function of
 *  the file that reaches one. */
function platformResetHooks(code: string): string[] {
	const resetters = new Set([...RESET_NAMES, ...resetAliases(code)]);
	const functions = localFunctions(code);
	let grew = true;
	while (grew) {
		const pattern = namesPattern([...resetters]);
		const found = functions.filter((fn) => !resetters.has(fn.name) && pattern.test(fn.body));
		for (const fn of found) resetters.add(fn.name);
		grew = found.length > 0;
	}
	const pattern = namesPattern([...resetters]);
	return HOOKS.flatMap((hook) => callsTo(code, hook)).filter((args) => pattern.test(args));
}

// Built-in registrations survive the reset, and the live cleaner slots sit outside it.
const PLUGIN_REGISTRATION = new RegExp(
	`(?<!function\\s+)\\b(?:${['install', 'Plugins'].join('')}|activateDirective\\w*|declarePlugin\\w*|register(?!Built[Ii]n|Live)[A-Z]\\w*)\\s*\\(`
);
// A body opens after a parameter list and its return type, which may be one flat object type.
const FUNCTION_BODY = /\)\s*(?::\s*(?:\{[^{}]*\}|[^{=;]*))?\s*\{/g;
const DEFERRED_CALL =
	/\b(?:it|test|describe|beforeEach|afterEach|beforeAll|afterAll)\b[\w.]*\s*\(/g;

/** `body` with every part that runs later blanked: test and hook arguments, and function bodies. */
function codeRunAtLoad(body: string): string {
	const spans: [number, number][] = [];
	const blankRegion = (open: number) => {
		const region = balancedRegion(body, open);
		if (region !== null) spans.push([open, open + region.length]);
	};
	for (const m of body.matchAll(DEFERRED_CALL)) blankRegion(m.index + m[0].length - 1);
	for (const m of body.matchAll(FUNCTION_BODY)) blankRegion(m.index + m[0].length - 1);
	for (const m of body.matchAll(/=>\s*(\{)?/g)) {
		const at = m.index + m[0].length;
		if (m[1] !== undefined) blankRegion(at - 1);
		else spans.push([at, at + arrowExpression(body, at).length]);
	}
	return spans.reduce(
		(text, [from, to]) => text.slice(0, from) + ' '.repeat(to - from) + text.slice(to),
		body
	);
}

/** What a file runs as it loads: its top level, and each describe callback's own statements. */
function loadTimeCode(code: string): string[] {
	const bare = literalSpans(code).reduce(
		(text, span) =>
			text.slice(0, span.start) + ' '.repeat(span.end - span.start) + text.slice(span.end),
		code
	);
	const bodies = callsTo(bare, 'describe').flatMap((args) => {
		const open = /=>\s*\{/.exec(args);
		const body = open && balancedBlock(args, open.index + open[0].length);
		return body ? [body] : [];
	});
	return [bare, ...bodies].map(codeRunAtLoad);
}

function loadTimeRegistration(code: string): boolean {
	return (
		loadTimeCode(code).some((text) => PLUGIN_REGISTRATION.test(text)) ||
		callsTo(code, 'beforeAll').some((args) => PLUGIN_REGISTRATION.test(args))
	);
}
const hookCall = (hook: string, body: string) => `${hook}(() => ${body});`;

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
			'src/lib/e2e/goto-ready.ts':
				'the navigation budget: the clock divides one ceiling between the load and the waits after it, and asserts nothing about how long any took'
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
	},
	{
		id: 'e2e specs aim at text through the editor’s own offset mapping',
		population: under('src/lib/e2e/tests/'),
		matches: /\bcreateTreeWalker\s*\(/,
		allowed: {
			'src/lib/e2e/tests/plugins/showcase-occurrences.spec.ts':
				'drives the `/` showcase, a page with no test bridge, so there is no editor mapping to ask',
			'src/lib/e2e/tests/plugins/snap-caret-height.spec.ts':
				'measures the browser’s own caret box in the prose, the reference the drawn caret is held to'
		},
		reason:
			'a text walk in a spec counts widget glyphs and hidden marker text its own way, so its aim point drifts from the offset the editor means: use pointAtRaw or textRunRect from e2e/text-runs.ts',
		hits: [
			at('src/lib/e2e/tests/x.spec.ts', 'const w = document.createTreeWalker(el, 4);'),
			at('src/lib/e2e/tests/y/helpers.ts', 'document.createTreeWalker (root, NodeFilter.SHOW_TEXT)')
		],
		misses: [
			at('src/lib/e2e/tests/x.spec.ts', "const at = await pointAtRaw(page, [0], 3, 'after');"),
			at('src/lib/e2e/text-runs.ts', 'document.createTreeWalker(el, 4);')
		]
	},
	{
		id: 'every unit test starts from a clean plugin platform, which the unit setup alone resets',
		population: under('src/lib/test/'),
		matches: (file) => platformResetHooks(file.code).length > 0,
		allowed: {
			'src/lib/test/support/plugin-platform.ts': 'the unit setup’s own reset, before every test',
			'src/lib/test/plugins/plugin-reset-isolation.test.ts':
				'a plugin author’s suite on the published testing API, whose `beforeEach` reset is the recipe under test'
		},
		reason:
			'test/support/plugin-platform.ts resets the plugin platform before every test, so a hook of a file’s own, whole or partial, is a second copy that drifts; a test asserting what a reset does calls it inside the test',
		reaches: ['src/lib/test/support/plugin-platform.ts'],
		hits: [
			at('src/lib/test/a.test.ts', hookCall('beforeEach', resetCall(PUBLIC_RESET))),
			at('src/lib/test/b.test.ts', `afterEach(${SCHEMA_RESET});`),
			at(
				'src/lib/test/c.test.ts',
				`function again() {\n\t${resetCall(PUBLIC_RESET)}\n}\nbeforeAll(again);`
			),
			at(
				'src/lib/test/d.test.ts',
				`const again = () => ${resetCall(PUBLIC_RESET)}\nbeforeEach(again);`
			),
			at(
				'src/lib/test/e.test.ts',
				`import { ${PUBLIC_RESET} as wipe } from '$lib/testing';\nbeforeEach(wipe);`
			),
			at('src/lib/test/f.test.ts', `afterEach(${RESET_NAMES[RESET_NAMES.length - 1]});`)
		],
		misses: [
			at('src/lib/test/g.test.ts', `it('drops it', () => {\n\t${resetCall(PUBLIC_RESET)}\n});`),
			at('src/lib/test/h.test.ts', hookCall('beforeEach', 'registerMathBlock()')),
			at('src/lib/test/i.test.ts', `const again = () => registerMathBlock();\nbeforeEach(again);`)
		]
	},
	{
		id: 'a unit test helper module leaves the plugin platform reset to the unit setup',
		population: (file) =>
			file.relPath.startsWith('src/lib/test/') && !file.relPath.endsWith('.test.ts'),
		matches: (file) => PLATFORM_RESET.test(file.code) || resetAliases(file.code).length > 0,
		allowed: {
			'src/lib/test/support/plugin-platform.ts': 'the unit setup’s own reset, before every test',
			'src/lib/test/core/inline/scan/scan-test-helpers.ts':
				'`scanClean` takes the bare reading partway through a test, so its caller can register after it'
		},
		reason:
			'a helper that resets hides a second copy of the unit setup’s reset behind a name, where the hook scan above cannot see it; register in the helper and let the setup reset',
		reaches: ['src/lib/test/core/inline/scan/scan-test-helpers.ts'],
		hits: [
			at(
				'src/lib/test/x/helper.ts',
				`export function wipeAll() {\n\t${resetCall(SCHEMA_RESET)}\n}`
			),
			at(
				'src/lib/test/x/fixture.svelte.ts',
				`import { ${PUBLIC_RESET} as wipe } from '$lib/testing';`
			)
		],
		misses: [
			at('src/lib/test/x/helper.ts', 'export function registerAll() {\n\tregisterMathBlock();\n}'),
			at('src/lib/test/x/a.test.ts', `it('drops it', () => ${resetCall(PUBLIC_RESET)});`)
		]
	},
	{
		id: 'a unit test registers plugin state per test, never at load or in `beforeAll`',
		population: under('src/lib/test/'),
		matches: (file) => loadTimeRegistration(file.code),
		allowed: {
			'src/lib/test/plugin-platform-reset.test.ts':
				'registers at load and in `beforeAll` on purpose, to pin that the unit setup wipes both',
			'src/lib/test/invariants/lint/consumer-guide-chords.test.ts':
				'installs at load too, so its row tables can name the bundled kinds; each test installs again'
		},
		reason:
			'the unit setup resets the plugin platform before every test, so a registration made at load (a file’s or a describe’s own statements) or in `beforeAll` is gone before the first test runs, and a suite built on it passes on the bare grammar: register in `beforeEach` or in the test',
		hits: [
			at('src/lib/test/a.test.ts', hookCall('beforeAll', 'registerMathBlock()')),
			at('src/lib/test/b.test.ts', `${['install', 'Plugins'].join('')}([footnotesPlugin()]);`),
			at('src/lib/test/c.test.ts', "const note = declarePluginKind('note');"),
			at(
				'src/lib/test/d.test.ts',
				"describe('x', () => {\n\tregisterMathBlock();\n\tit('y', () => {});\n});"
			),
			at(
				'src/lib/test/e.test.ts',
				"describe('x', () => {\n\tconst K = declarePluginKind('k');\n\tit('y', () => {});\n});"
			)
		],
		misses: [
			at('src/lib/test/f.test.ts', hookCall('beforeEach', 'registerMathBlock()')),
			at('src/lib/test/g.test.ts', hookCall('beforeAll', 'installLayoutStubs()')),
			at(
				'src/lib/test/h.test.ts',
				'registerBuiltInDescriptors();\nbeforeAll(registerLiveJoinSeamCleaner);'
			),
			at(
				'src/lib/test/i.test.ts',
				"const p = definePlugin({\n\tsetup() {\n\t\tregisterLanguage('x', g);\n\t}\n});"
			),
			at(
				'src/lib/test/j.test.ts',
				"describe('x', () => {\n\tit('y', () => {\n\t\tregisterMathBlock();\n\t});\n});"
			)
		]
	}
];

describeFileRules(RULES, SOURCES);

describe('the reset names the platform scans read off the source', () => {
	it('finds every reset a library module enrolls by name', () => {
		const probe = probeFile(at('src/lib/x.ts', `${'enrollTestReset'}(__resetProbeForTests);`));
		expect(enrolledResets([probe])).toEqual(['__resetProbeForTests']);
		expect(enrolledResets(SOURCES).length).toBeGreaterThan(0);
	});
});

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
