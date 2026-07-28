import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import {
	registerGlobalCommand,
	__resetPluginGlobalCommandsForTests
} from '$lib/schema/global-commands';
import {
	getCommand,
	resolveBinding,
	resolveGlobalBinding,
	isEditorGlobalChord,
	pluginGlobalBinding,
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests,
	type GlobalCommandContext
} from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests,
	type EditorContext
} from '$lib/schema/plugin-install';

const editor = {
	editorId: 'e',
	document: { children: [] },
	events: {},
	options: { x: 1 }
} as never as EditorContext;
const ctx = (over?: Partial<GlobalCommandContext>): GlobalCommandContext => ({
	history: { requestUndo() {}, requestRedo() {} },
	pluginEditor: () => editor,
	...over
});

beforeEach(() => {
	__resetPluginGlobalCommandsForTests();
	__resetPluginGlobalKeymapForTests();
	__removePluginCommandsForTests();
	__resetMintedCommandIdsForTests();
});

describe('registerGlobalCommand', () => {
	it('mints, registers, and the handler receives the per-instance EditorContext', () => {
		let got: EditorContext | undefined;
		const id = registerGlobalCommand('demo.stats', (e) => ((got = e), true));
		expect(getCommand(id)!(ctx())).toBe(true);
		expect(got).toBe(editor);
	});

	it('declines (false) when the dispatch site supplies no pluginEditor', () => {
		const id = registerGlobalCommand('demo.lone', () => true);
		expect(getCommand(id)!(ctx({ pluginEditor: undefined }))).toBe(false);
	});

	it('contains a handler throw and reports it through the injected sink', () => {
		const reports: unknown[] = [];
		const id = registerGlobalCommand('demo.boom', () => {
			throw new Error('boom');
		});
		expect(getCommand(id)!(ctx({ onCommandError: (r) => reports.push(r) }))).toBe(true);
		expect(reports).toHaveLength(1);
	});

	it('chord registers into the plugin-global tier; built-in chords are unstealable', () => {
		registerGlobalCommand('demo.chorded', () => true, { chord: 'Mod+Shift+9' });
		expect(pluginGlobalBinding('Mod+Shift+9')?.command).toBe('demo.chorded');
		expect(isEditorGlobalChord('Mod+Shift+9')).toBe(true);
		expect(resolveGlobalBinding('Mod+Shift+9')?.command).toBe('demo.chorded');
		expect(resolveBinding('Mod+Shift+9', 'paragraph')?.command).toBe('demo.chorded');
		expect(() => registerGlobalCommand('demo.steal', () => true, { chord: 'Mod+Z' })).toThrow(
			/Mod\+Z/
		);
		expect(() => registerGlobalCommand('demo.dup', () => true, { chord: 'Mod+Shift+9' })).toThrow();
		expect(() => registerGlobalCommand('demo.search', () => true, { chord: 'Mod+F' })).toThrow(
			/reserved/
		);
	});

	// Red-first: pre-fix, assertPluginGlobalChordAvailable normalized `Ctrl+W`
	// (non-strict) to a bare `W` — not reserved, no collision — so registration
	// SUCCEEDED and `resolveBinding('W', 'paragraph')` returned the probe binding,
	// firing the handler on every plain `w`.
	it('rejects a malformed chord and binds nothing (the Ctrl+W trap)', () => {
		expect(() => registerGlobalCommand('demo.malformed', () => true, { chord: 'Ctrl+W' })).toThrow(
			/malformed/
		);
		expect(pluginGlobalBinding('W')).toBeNull();
		expect(resolveBinding('W', 'paragraph')).toBeNull();
	});

	it('a chord collision leaves no partial state — the name can still be minted afterward', () => {
		expect(() => registerGlobalCommand('demo.retry', () => true, { chord: 'Mod+Z' })).toThrow();
		expect(() =>
			registerGlobalCommand('demo.retry', () => true, { chord: 'Mod+Shift+6' })
		).not.toThrow();
	});

	it('a consumer global override disables a plugin-global chord', () => {
		registerGlobalCommand('demo.overridable', () => true, { chord: 'Mod+Shift+8' });
		const overrides = normalizeKeybindingOverrides([{ chord: 'Mod+Shift+8', command: null }]);
		expect(resolveBinding('Mod+Shift+8', 'paragraph', overrides)).toBeNull();
	});
});

// The SSR/HMR registrar-poison residual: a chorded global command re-runs its
// registration on a dev-server re-eval and its chord collision throw 500'd the
// route. In dev-and-not-test a same-command re-bind now replaces idempotently;
// cross-command collisions and reserved chords keep the throw, and prod/test keep
// the register-once throw everywhere.
describe('chorded global command survives dev re-eval', () => {
	afterEach(() => resetEditorEnv());

	it('re-binding the same command+chord replaces instead of throwing', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' });
		expect(() =>
			registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' })
		).not.toThrow();
		// One binding survives — a re-eval must not stack a duplicate.
		expect(pluginGlobalBinding('Mod+Shift+7')?.command).toBe('demo.dev');
		expect(resolveBinding('Mod+Shift+7', 'paragraph')?.command).toBe('demo.dev');
	});

	it('a cross-command chord collision still throws under dev re-eval', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		registerGlobalCommand('demo.owner', () => true, { chord: 'Mod+Shift+7' });
		expect(() => registerGlobalCommand('demo.thief', () => true, { chord: 'Mod+Shift+7' })).toThrow(
			/already bound/
		);
	});

	it('a reserved UI chord still throws under dev re-eval', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		expect(() => registerGlobalCommand('demo.search', () => true, { chord: 'Mod+F' })).toThrow(
			/reserved/
		);
	});

	it('under test the same command+chord re-registration still throws', () => {
		registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' });
		expect(() => registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' })).toThrow();
	});
});

// The mint's owner is what distinguishes a plugin re-minting its own name from a
// cross-plugin collision, and it is what the collision message names. The block
// sibling passes it; this one minted anonymously, so a second plugin's collision
// reported "another registration" and named nobody.
describe('registerGlobalCommand owner attribution', () => {
	afterEach(() => {
		__resetInstalledPluginsForTests();
	});

	it('names the owning plugin when a second plugin re-mints the same command', () => {
		installPlugins([
			definePlugin({
				name: 'first',
				setup: () => {
					registerGlobalCommand('shared.name', () => true);
				}
			})
		]);

		expect(() =>
			installPlugins([
				definePlugin({
					name: 'second',
					setup: () => {
						registerGlobalCommand('shared.name', () => true);
					}
				})
			])
		).toThrow(/plugin "first"/);
	});
});
