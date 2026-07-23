import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
	resetPluginPlatformForTests,
	runContainerConformance,
	runKindConformance,
	checkCopyIsRawByteSlice
} from '$lib/testing';
import {
	declarePluginKind,
	declarePluginInlineKind,
	isInlineKindDeclared,
	registerBlockKind,
	registerBlockOpener,
	registerBlockCommand,
	registerGlobalCommand,
	registerInlineSyntax,
	registerInlineWidgetKind,
	registerPasteTransform,
	registerDirective,
	isBlockKindRegistered,
	isBlockOpenerRegistered,
	isDirectiveRegistered,
	definePlugin,
	isPluginInstalled
} from '$lib/plugin';
import { installPlugins, onEditorCallbacks } from '$lib/schema/plugin-install';
import { pluginGlobalBinding } from '$lib/schema/commands';
import { registerPasteSurface, getPasteSurface } from '$lib/tree-operations/paste-surfaces';
import { getInlineRungs } from '$lib/core/inline/scan/plugin-syntax';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import { stripComments } from '../invariants/lint/scan-source';
import { testClosure } from '$lib/test/support/closure';
import type { AnyBlockKind } from '$lib/plugin';

// Registers one thing through each public register-once entry the aggregate must
// clear. A new public registration added without wiring its reset into
// `resetPluginPlatformForTests` re-throws its dup here on the re-install below —
// keep this in lockstep with the aggregate.
function installProbePlugin(): void {
	const block = declarePluginKind('probe-block');
	const inline = declarePluginInlineKind('probe-inline');
	registerBlockKind(block, {
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		closure: testClosure
	});
	registerBlockOpener(block, { priority: 0, tryOpen: () => null, interruptsParagraph: false });
	registerBlockCommand(block, 'probe.cmd', () => true);
	registerGlobalCommand('probe.global', () => true, { chord: 'Mod+Shift+1' });
	registerPasteSurface({ kind: block });
	registerPasteTransform({ name: 'probe-transform', transform: () => null });
	registerInlineSyntax('⌘', () => null);
	registerInlineWidgetKind(inline, { isWidget: () => false });
	registerDirective('text', 'probe-dir', { kind: inline });
	installPlugins([definePlugin({ name: 'probeplugin', setup: (ctx) => ctx.onEditor(() => {}) })]);
}

describe('resetPluginPlatformForTests aggregate', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('clears every public register-once registry so a re-install never throws a dup', () => {
		installProbePlugin();
		expect(isBlockKindRegistered('probe-block')).toBe(true);
		expect(isBlockOpenerRegistered('probe-block')).toBe(true);
		expect(isInlineKindDeclared('probe-inline')).toBe(true);
		expect(isDirectiveRegistered('text', 'probe-dir')).toBe(true);
		expect(isPluginInstalled('probeplugin')).toBe(true);
		expect(onEditorCallbacks('probeplugin')).toHaveLength(1);
		expect(pluginGlobalBinding('Mod+Shift+1')?.command).toBe('probe.global');

		resetPluginPlatformForTests();

		expect(isBlockKindRegistered('probe-block')).toBe(false);
		expect(isBlockOpenerRegistered('probe-block')).toBe(false);
		expect(isInlineKindDeclared('probe-inline')).toBe(false);
		expect(isDirectiveRegistered('text', 'probe-dir')).toBe(false);
		expect(isPluginInstalled('probeplugin')).toBe(false);
		expect(onEditorCallbacks('probeplugin')).toHaveLength(0);
		expect(pluginGlobalBinding('Mod+Shift+1')).toBeNull();
		expect(getPasteSurface('probe-block' as AnyBlockKind)).toBeUndefined();
		expect(getInlineRungs('⌘')).toHaveLength(0);

		// The register-once dup throw is exactly what a third-party suite hits
		// without a sanctioned reset — re-running the whole setup must be clean.
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

// ── Published conformance surface ───────────────────────────────────────────────
// The seams a third-party suite imports from `aragonite/testing`. A rename or a
// dropped re-export fails to resolve here rather than in a downstream author's suite.

describe('aragonite/testing conformance surface', () => {
	it('publishes both conformance runners and the byte-slice guard', () => {
		expect(typeof runContainerConformance).toBe('function');
		expect(typeof runKindConformance).toBe('function');
		expect(typeof checkCopyIsRawByteSlice).toBe('function');
	});
});

// ── What the published `aragonite/testing` surface may depend on ────────────────

/** `testing.ts` plus every module behind it — the code that ships as `aragonite/testing`. */
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

describe('aragonite/testing dependency rules', () => {
	const sources = testingSurfaceSources();

	it('sees the whole surface — the barrel plus the modules behind it, with their imports', () => {
		expect(sources.map((s) => s.relPath)).toContain('src/lib/testing.ts');
		expect(sources.length).toBeGreaterThan(1);
		expect(sources.flatMap((s) => s.specifiers).length).toBeGreaterThan(5);
	});

	// The conformance kit runs INSIDE an author's own test case. A static runner
	// import would force that runner (an unlisted dep) on every suite that reaches
	// for `resetPluginPlatformForTests` alone — including one on Jest or node:test.
	// The kit throws plain `Error`s instead; keep it that way.
	it('imports no test runner', () => {
		const offenders = offendersMatching(sources, /^(vitest|jest|@jest\/|node:test|chai)/);
		expect(offenders, 'runner imports on the published testing surface').toEqual([]);
	});

	// `prune-dist.mjs` deletes `dist/test` before pack, and `verify-pack.mjs` fails
	// on any test file that ships. An import reaching into `test/` therefore resolves
	// in the repo and 404s in the published package — a break no in-repo suite sees.
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
