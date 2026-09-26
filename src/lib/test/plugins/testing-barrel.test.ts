import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import python from 'highlight.js/lib/languages/python';
import {
	applyPasteTransforms,
	configureEditorEnv,
	installEditorDomStubsForTests,
	resetEditorEnv,
	resetPluginPlatformForTests,
	runContainerConformance,
	runKindConformance,
	checkCopyIsRawByteSlice,
	setDevWarnSink
} from '$lib/testing';
import {
	declarePluginKind,
	declarePluginInlineKind,
	isInlineKindDeclared,
	registerBlockKind,
	registerBlockComponent,
	registerBlockOpener,
	registerBlockCompleter,
	registerBlockCommand,
	registerBlockContextActions,
	registerChromeLeaf,
	registerGlobalCommand,
	registerInlineSyntax,
	registerInlineWidgetKind,
	registerInsertEntry,
	registerLanguage,
	registerPasteTransform,
	registerDirective,
	isBlockKindDeclared,
	isBlockKindRegistered,
	isBlockComponentRegistered,
	isBlockOpenerRegistered,
	isBlockCompleterRegistered,
	isPasteTransformRegistered,
	isDirectiveRegistered,
	listLanguages,
	definePlugin,
	isPluginInstalled,
	type BlockComponentEntry,
	type NodeView,
	type PluginBlockKind,
	type PluginInlineKind
} from '$lib/plugin';
import { devWarn } from '$lib/dev-warn';
import { installPlugins, onEditorCallbacks } from '$lib/schema/plugin-install';
import { pluginGlobalBinding } from '$lib/schema/commands';
import { getBlockCommand } from '$lib/schema/block-commands';
import { blockContextActionsFor } from '$lib/schema/context-actions';
import { insertCatalogue } from '$lib/schema/insert-catalogue';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { isInlineWidget } from '$lib/core/inline/inline-widgets';
import { getInlineRungs } from '$lib/core/inline/scan/plugin-syntax';
import { stripComments } from '../invariants/lint/scan-source';
import { testClosure } from '$lib/test/support/closure';

// ── One probe per public registration ────────────────────────────────────────
// Each registers once through a register or declare function the plugin barrel exports, and
// says whether that registration is still there. The list is checked against the barrel's own
// exports, so a new public registration without a probe reds, and one the reset misses reds
// on the second install.

let block: PluginBlockKind;
let chrome: PluginBlockKind;
let inline: PluginInlineKind;
const blockNode = () => ({ kind: block, raw: 'x\n' }) as unknown as NodeView;

const PROBES: { entry: string; register(): void; registered(): boolean }[] = [
	{
		entry: 'declarePluginKind',
		register: () => {
			block = declarePluginKind('probe-block');
			chrome = declarePluginKind('probe-chrome');
		},
		registered: () => isBlockKindDeclared('probe-block')
	},
	{
		entry: 'declarePluginInlineKind',
		register: () => void (inline = declarePluginInlineKind('probe-inline')),
		registered: () => isInlineKindDeclared('probe-inline')
	},
	{
		entry: 'registerBlockKind',
		register: () =>
			registerBlockKind(block, {
				gapEdges: 'none',
				mergeRole: 'not-mergeable',
				editable: false,
				supportsInline: false,
				closure: testClosure
			}),
		registered: () => isBlockKindRegistered('probe-block')
	},
	{
		entry: 'registerBlockComponent',
		register: () => registerBlockComponent(block, {} as BlockComponentEntry),
		registered: () => isBlockComponentRegistered('probe-block')
	},
	{
		entry: 'registerBlockOpener',
		register: () =>
			registerBlockOpener(block, { priority: 0, tryOpen: () => null, interruptsParagraph: false }),
		registered: () => isBlockOpenerRegistered('probe-block')
	},
	{
		entry: 'registerBlockCompleter',
		register: () => registerBlockCompleter(block, { tryComplete: () => null }),
		registered: () => isBlockCompleterRegistered('probe-block')
	},
	{
		entry: 'registerBlockCommand',
		register: () => void registerBlockCommand(block, 'probe.cmd', () => true),
		registered: () =>
			getBlockCommand(block, 'probe.cmd' as never, everyInstalledPlugin) !== undefined
	},
	{
		entry: 'registerBlockContextActions',
		register: () =>
			registerBlockContextActions('probe-block', 'probe', () => [
				{ id: 'probe.row', label: 'Probe', run: () => {} }
			]),
		registered: () =>
			blockContextActionsFor(blockNode(), [0], everyInstalledPlugin, 'block').length > 0
	},
	{
		entry: 'registerChromeLeaf',
		register: () => registerChromeLeaf(chrome),
		registered: () => isBlockKindRegistered('probe-chrome')
	},
	{
		entry: 'registerGlobalCommand',
		register: () =>
			void registerGlobalCommand('probe.global', () => true, { chord: 'Mod+Shift+1' }),
		registered: () => pluginGlobalBinding('Mod+Shift+1', everyInstalledPlugin) !== null
	},
	{
		entry: 'registerInlineSyntax',
		register: () => registerInlineSyntax('⌘', () => null),
		registered: () => getInlineRungs('⌘').length > 0
	},
	{
		entry: 'registerInlineWidgetKind',
		register: () => registerInlineWidgetKind(inline, { isWidget: () => true }),
		registered: () =>
			isInlineWidget({ kind: inline, start: 0, end: 1 } as never, 'x', defaultGrammarView)
	},
	{
		entry: 'registerInsertEntry',
		register: () =>
			registerInsertEntry({
				id: 'probe-entry',
				label: 'Probe',
				icon: 'plus',
				keywords: [],
				markdown: 'probe\n'
			}),
		registered: () => insertCatalogue(everyInstalledPlugin).some((e) => e.id === 'probe-entry')
	},
	{
		entry: 'registerLanguage',
		register: () => registerLanguage('probe-lang', python),
		registered: () => listLanguages().includes('probe-lang')
	},
	{
		entry: 'registerPasteTransform',
		register: () => registerPasteTransform({ name: 'probe-transform', transform: () => null }),
		registered: () => isPasteTransformRegistered('probe-transform')
	},
	{
		entry: 'registerDirective',
		register: () => registerDirective('text', 'probe-dir', { kind: inline }),
		registered: () => isDirectiveRegistered('text', 'probe-dir')
	}
];

/** Every `register*` and `declare*` value the plugin barrel exports. */
function publicRegistrations(): string[] {
	const code = stripComments(readFileSync(path.resolve('src/lib/plugin.ts'), 'utf8'));
	const names = [
		...[...code.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) =>
			m[1].split(',').map((spec) =>
				spec
					.trim()
					.split(/\s+as\s+/)
					.pop()!
			)
		),
		...[...code.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1])
	];
	return names.filter((name) => /^(register|declare)[A-Z]/.test(name)).sort();
}

function installProbePlugin(): void {
	for (const probe of PROBES) probe.register();
	installPlugins([definePlugin({ name: 'probeplugin', setup: (ctx) => ctx.onEditor(() => {}) })]);
}

describe('resetPluginPlatformForTests aggregate', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('probes every registration the plugin barrel exports', () => {
		expect(PROBES.map((p) => p.entry).sort()).toEqual(publicRegistrations());
	});

	it('clears every public registration so a re-install never throws a dup', () => {
		installProbePlugin();
		const still = () => PROBES.filter((p) => p.registered()).map((p) => p.entry);
		expect(still()).toEqual(PROBES.map((p) => p.entry));
		expect(isPluginInstalled('probeplugin')).toBe(true);
		expect(onEditorCallbacks('probeplugin')).toHaveLength(1);

		resetPluginPlatformForTests();

		expect(still()).toEqual([]);
		expect(isPluginInstalled('probeplugin')).toBe(false);
		expect(onEditorCallbacks('probeplugin')).toHaveLength(0);

		// The duplicate-registration throw is exactly what a third-party suite hits without
		// the supported reset; re-running the whole setup must be clean.
		expect(() => installProbePlugin()).not.toThrow();
	});

	it('throws when called outside a detected test environment', () => {
		configureEditorEnv({ isTest: false });
		try {
			expect(() => resetPluginPlatformForTests()).toThrow(/test-only/);
		} finally {
			resetEditorEnv();
		}
	});
});

// ── Published conformance API ───────────────────────────────────────────────
// What a third-party suite imports from `@voithos-labs/aragonite/testing`. A rename or a
// dropped re-export fails to resolve here rather than in a downstream author's suite.

describe('@voithos-labs/aragonite/testing conformance surface', () => {
	it('publishes both conformance runners and the byte-slice guard', () => {
		expect(typeof runContainerConformance).toBe('function');
		expect(typeof runKindConformance).toBe('function');
		expect(typeof checkCopyIsRawByteSlice).toBe('function');
	});

	it('publishes the paste-pipeline driver and the mount stubs', () => {
		expect(typeof applyPasteTransforms).toBe('function');
		expect(typeof installEditorDomStubsForTests).toBe('function');
	});

	// The reset's own error tells a non-Vitest runner to opt in through this function, so it
	// has to be reachable from the subpath that error is thrown on.
	it('publishes the editor-env override door', () => {
		expect(typeof configureEditorEnv).toBe('function');
		expect(typeof resetEditorEnv).toBe('function');
	});

	// An author's own fail-on-warn gate needs the same channel this repo's gate reads.
	it('publishes the dev-warning sink, which hands back the sink it replaced', () => {
		const seen: unknown[] = [];
		const gate = setDevWarnSink((entry) => seen.push(entry));
		devWarn('probe', 'through the published sink');
		expect(setDevWarnSink(gate)).not.toBe(gate);
		expect(seen).toEqual([
			{ tag: 'probe', message: 'through the published sink', details: undefined }
		]);
	});
});

// ── What the published `@voithos-labs/aragonite/testing` code may depend on ────────────────

/** `testing.ts` plus every module behind it: the code that ships as
 *  `@voithos-labs/aragonite/testing`. */
function testingSurfaceSources(): { relPath: string; specifiers: string[] }[] {
	const dir = path.resolve('src/lib/testing');
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.ts'))
		.map((f) => `src/lib/testing/${f}`);
	return ['src/lib/testing.ts', ...files].map((relPath) => {
		// Comments here name the very specifiers the scans forbid; strip them first.
		const code = stripComments(readFileSync(path.resolve(relPath), 'utf8'));
		const specifiers = [...code.matchAll(/(?:\bfrom|\bimport)\s+'([^']+)'/g)].map((m) => m[1]);
		return { relPath, specifiers };
	});
}

const offendersMatching = (
	sources: { relPath: string; specifiers: string[] }[],
	pattern: RegExp
): string[] =>
	sources.flatMap((s) =>
		s.specifiers.filter((spec) => pattern.test(spec)).map((spec) => `${s.relPath} → ${spec}`)
	);

describe('@voithos-labs/aragonite/testing dependency rules', () => {
	const sources = testingSurfaceSources();

	it('sees the whole surface: the barrel plus the modules behind it, with their imports', () => {
		expect(sources.map((s) => s.relPath)).toContain('src/lib/testing.ts');
		expect(sources.length).toBeGreaterThan(1);
		expect(sources.flatMap((s) => s.specifiers).length).toBeGreaterThan(5);
	});

	// The kit runs inside an author's own test case, so a static runner import would force
	// that runner on every suite reaching for `resetPluginPlatformForTests` alone, including
	// one on Jest or node:test. It throws plain `Error`s instead.
	it('imports no test runner', () => {
		const offenders = offendersMatching(sources, /^(vitest|jest|@jest\/|node:test|chai)/);
		expect(offenders, 'runner imports on the published testing surface').toEqual([]);
	});

	// `prune-dist.mjs` deletes `dist/test` before pack and `verify-pack.mjs` rejects any
	// that ship, so an import reaching into `test/` resolves in the repo and 404s in the
	// published package, a break no in-repo suite sees.
	it('reaches into no directory that is stripped from the published package', () => {
		const offenders = offendersMatching(sources, /(^|\/)(test|e2e)\//);
		expect(offenders, 'imports of paths pruned from dist/').toEqual([]);
	});

	// Non-vacuity: both scans must actually fire on the shapes they forbid.
	it('the scans flag a runner import and a pruned-path import', () => {
		const synthetic = [
			{
				relPath: 'synthetic.ts',
				specifiers: ['vitest', '$lib/test/harness/editor-actions', '../env']
			}
		];
		expect(offendersMatching(synthetic, /^(vitest|jest|@jest\/|node:test|chai)/)).toEqual([
			'synthetic.ts → vitest'
		]);
		expect(offendersMatching(synthetic, /(^|\/)(test|e2e)\//)).toEqual([
			'synthetic.ts → $lib/test/harness/editor-actions'
		]);
	});
});
