import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureEditorEnv } from '$lib/env';
import { allowDevWarns, takeDevWarns } from '../support/warn-gate';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import {
	getCommand,
	resolveBinding,
	resolveGlobalBinding,
	isDefaultGlobalChord,
	pluginGlobalBinding,
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests,
	type GlobalCommandContext
} from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
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
	activation: everyInstalledPlugin,
	pluginEditor: () => editor,
	...over
});

beforeEach(() => {
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
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});

	// A plugin installed process-wide but absent from this editor's `plugins` prop resolves no
	// context here. That is inactive by design, so it must not use up the key-does-nothing warning.
	it('declines quietly when the dispatching editor did not list the owning plugin', () => {
		__resetInstalledPluginsForTests();
		let ran = false;
		let id!: ReturnType<typeof registerGlobalCommand>;
		installPlugins([
			definePlugin({
				name: 'scoped',
				setup() {
					id = registerGlobalCommand('scoped.act', () => ((ran = true), true));
				}
			})
		]);
		expect(getCommand(id)!(ctx({ pluginEditor: () => undefined }))).toBe(false);
		expect(ran).toBe(false);
		expect(takeDevWarns()).toEqual([]);
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
		expect(pluginGlobalBinding('Mod+Shift+9', everyInstalledPlugin)?.command).toBe('demo.chorded');
		expect(isDefaultGlobalChord('Mod+Shift+9', everyInstalledPlugin)).toBe(true);
		expect(resolveGlobalBinding('Mod+Shift+9', undefined, everyInstalledPlugin)?.command).toBe(
			'demo.chorded'
		);
		expect(
			resolveBinding('Mod+Shift+9', 'paragraph', undefined, everyInstalledPlugin)?.command
		).toBe('demo.chorded');
		expect(() => registerGlobalCommand('demo.steal', () => true, { chord: 'Mod+Z' })).toThrow(
			/Mod\+Z/
		);
		expect(() => registerGlobalCommand('demo.dup', () => true, { chord: 'Mod+Shift+9' })).toThrow();
		expect(() => registerGlobalCommand('demo.search', () => true, { chord: 'Mod+F' })).toThrow(
			/reserved/
		);
	});

	// A non-strict normalize collapses `Ctrl+W` to a bare `W`, which is neither reserved nor
	// colliding, so the binding registers and fires on every plain `w`.
	it('rejects a malformed chord and binds nothing (the Ctrl+W trap)', () => {
		expect(() => registerGlobalCommand('demo.malformed', () => true, { chord: 'Ctrl+W' })).toThrow(
			/malformed/
		);
		expect(pluginGlobalBinding('W', everyInstalledPlugin)).toBeNull();
		expect(resolveBinding('W', 'paragraph', undefined, everyInstalledPlugin)).toBeNull();
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
		expect(resolveBinding('Mod+Shift+8', 'paragraph', overrides, everyInstalledPlugin)).toBeNull();
	});
});

// SSR and hot reload re-run a plugin's registration: a chord collision from that must not break
// the route. Only re-binding the same command, on a dev server outside tests, is forgiven.
describe('chorded global command survives dev re-eval', () => {
	// The dev-server path warns on every replacement it makes; these cases are about what throws.
	afterEach(() => allowDevWarns(['registry']));

	it('re-binding the same command+chord replaces instead of throwing', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' });
		expect(() =>
			registerGlobalCommand('demo.dev', () => true, { chord: 'Mod+Shift+7' })
		).not.toThrow();
		// One binding survives: a second evaluation must not add a duplicate.
		expect(pluginGlobalBinding('Mod+Shift+7', everyInstalledPlugin)?.command).toBe('demo.dev');
		expect(
			resolveBinding('Mod+Shift+7', 'paragraph', undefined, everyInstalledPlugin)?.command
		).toBe('demo.dev');
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

// Recording the owner is what separates a plugin reusing its own name from a collision between
// plugins, and the owner is what the collision message names.
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
