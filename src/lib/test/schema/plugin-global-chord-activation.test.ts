// Miss-analysis: the plugin-global chord suites drove one activation-blind dispatch each, so
// nothing asked what a SECOND editor makes of a chord the first editor's plugin registered
// process-wide (GH #265).
import { describe, it, expect, beforeEach } from 'vitest';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import {
	isDefaultGlobalChord,
	resolveBinding,
	resolveGlobalBinding,
	runGlobalChord,
	pluginGlobalChords,
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests,
	type GlobalChordContext
} from '$lib/schema/commands';
import { chordIsClaimed, collectReservedChords } from '$lib/schema/reserved-chords';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';
import { activationFor, everyInstalledPlugin } from '$lib/schema/plugin-activation';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests,
	type EditorContext
} from '$lib/schema/plugin-install';

const CHORD = 'Mod+Shift+9';

const listing = activationFor(['scoped']);
const notListing = activationFor(['other']);

let ran = 0;

function chordContext(activation: typeof listing): GlobalChordContext {
	return {
		isReading: false,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: (name) =>
			activation.isActive(name) ? ({} as never as EditorContext) : undefined,
		activation
	};
}

beforeEach(() => {
	__resetPluginGlobalKeymapForTests();
	__removePluginCommandsForTests();
	__resetMintedCommandIdsForTests();
	__resetInstalledPluginsForTests();
	ran = 0;
	installPlugins([
		definePlugin({
			name: 'scoped',
			setup() {
				registerGlobalCommand('scoped.act', () => (ran++, true), { chord: CHORD });
			}
		})
	]);
});

describe('a plugin-global chord is claimed only where the plugin is activated', () => {
	it('the listing editor resolves the binding and consumes the press', () => {
		expect(resolveGlobalBinding(CHORD, undefined, listing)?.command).toBe('scoped.act');
		expect(resolveBinding(CHORD, 'paragraph', undefined, listing)?.command).toBe('scoped.act');
		expect(isDefaultGlobalChord(CHORD, listing)).toBe(true);
		expect(runGlobalChord(CHORD, undefined, chordContext(listing))).toBe(true);
		expect(ran).toBe(1);
	});

	// The dead key: without the activation the press was swallowed and nothing ran, so the
	// chord reached neither the plugin nor the host.
	it('the editor that never listed it resolves nothing and lets the press through', () => {
		expect(resolveGlobalBinding(CHORD, undefined, notListing)).toBeNull();
		expect(resolveBinding(CHORD, 'paragraph', undefined, notListing)).toBeNull();
		expect(isDefaultGlobalChord(CHORD, notListing)).toBe(false);
		expect(runGlobalChord(CHORD, undefined, chordContext(notListing))).toBe(false);
		expect(ran).toBe(0);
	});

	it('the process-wide tier still enumerates every registered chord', () => {
		expect(pluginGlobalChords(everyInstalledPlugin)).toContain(CHORD);
		expect(pluginGlobalChords(listing)).toContain(CHORD);
		expect(pluginGlobalChords(notListing)).not.toContain(CHORD);
	});
});

describe('reservedChords answers for the instance that asks', () => {
	const reserved = (activation: typeof listing) =>
		collectReservedChords({ searchBar: false, activation });

	it('reports the chord to the listing editor and withholds it from the other', () => {
		expect(reserved(listing).has(CHORD)).toBe(true);
		expect(reserved(notListing).has(CHORD)).toBe(false);
	});

	// `claimsChord` composes over the same set, so a host asking per keystroke gets the
	// instance's answer rather than the process's.
	it('claimsChord follows it', () => {
		const press = { key: '9', ctrlKey: true, shiftKey: true } as KeyboardEvent;
		expect(chordIsClaimed(press, reserved(listing))).toBe(true);
		expect(chordIsClaimed(press, reserved(notListing))).toBe(false);
	});
});
