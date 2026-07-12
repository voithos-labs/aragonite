import { describe, it, expect, beforeEach } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	declarePluginKind,
	declarePluginInlineKind,
	isInlineKindDeclared,
	registerBlockKind,
	registerBlockOpener,
	registerBlockCommand,
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
import { installPlugins } from '$lib/schema/plugin-install';
import { registerPasteSurface, getPasteSurface } from '$lib/tree-operations/paste-surfaces';
import { getInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import type { AnyBlockKind } from '$lib/plugin';

// Registers one thing through each public register-once entry the aggregate must
// clear. A new public registration added without wiring its reset into
// `resetPluginPlatformForTests` re-throws its dup here on the re-install below —
// keep this in lockstep with the aggregate.
function installProbePlugin(): void {
	const block = declarePluginKind('probe-block');
	const inline = declarePluginInlineKind('probe-inline');
	registerBlockKind(block, { mergeRole: 'not-mergeable', editable: false, supportsInline: false });
	registerBlockOpener(block, { priority: 0, tryOpen: () => null, interruptsParagraph: false });
	registerBlockCommand(block, 'probe.cmd', () => true);
	registerPasteSurface({ kind: block });
	registerPasteTransform({ name: 'probe-transform', transform: () => null });
	registerInlineSyntax('⌘', () => null);
	registerInlineWidgetKind(inline, { isWidget: () => false });
	registerDirective('text', 'probe-dir', { kind: inline });
	installPlugins([definePlugin({ name: 'probeplugin', setup: () => {} })]);
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

		resetPluginPlatformForTests();

		expect(isBlockKindRegistered('probe-block')).toBe(false);
		expect(isBlockOpenerRegistered('probe-block')).toBe(false);
		expect(isInlineKindDeclared('probe-inline')).toBe(false);
		expect(isDirectiveRegistered('text', 'probe-dir')).toBe(false);
		expect(isPluginInstalled('probeplugin')).toBe(false);
		expect(getPasteSurface('probe-block' as AnyBlockKind)).toBeUndefined();
		expect(getInlineSyntax('⌘')).toBeUndefined();

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
