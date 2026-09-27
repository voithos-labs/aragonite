// Miss-analysis: GH #265; each plugin-global chord suite used one editor, never asking a second.
import { describe, it, expect, beforeEach } from 'vitest';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import {
	isDefaultGlobalChord,
	resolveBinding,
	resolveGlobalBinding,
	runGlobalChord,
	pluginGlobalChords
} from '$lib/schema/commands';
import type { CommandDispatchContext } from '$lib/schema/block-commands';
import { chordIsClaimed, collectReservedChords } from '$lib/schema/reserved-chords';
import { activationFor, everyInstalledPlugin } from '$lib/schema/plugin-activation';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests,
	type EditorContext
} from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { commandContext } from '../support/command-context';

const CHORD = 'Mod+Shift+9';

const listing = activationFor(['scoped']);
const notListing = activationFor(['other']);

let ran = 0;

function chordContext(activation: typeof listing): CommandDispatchContext {
	return commandContext({
		pluginEditor: (name) =>
			activation.isActive(name) ? ({} as never as EditorContext) : undefined,
		activation
	});
}

beforeEach(() => {
	__resetSchemaRegistriesForTests();
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
		expect(runGlobalChord(CHORD, chordContext(listing))).toBe(true);
		expect(ran).toBe(1);
	});

	// Resolving the chord here would swallow the keypress and run nothing, so it would reach
	// neither the plugin nor the host.
	it('the editor that never listed it resolves nothing and lets the press through', () => {
		expect(resolveGlobalBinding(CHORD, undefined, notListing)).toBeNull();
		expect(resolveBinding(CHORD, 'paragraph', undefined, notListing)).toBeNull();
		expect(isDefaultGlobalChord(CHORD, notListing)).toBe(false);
		expect(runGlobalChord(CHORD, chordContext(notListing))).toBe(false);
		expect(ran).toBe(0);
	});

	it('the process-wide level still enumerates every registered chord', () => {
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

	// `claimsChord` reads the same set, so a host asking on each keystroke gets this editor's
	// answer rather than the whole process's.
	it('claimsChord follows it', () => {
		const press = { key: '9', ctrlKey: true, shiftKey: true } as KeyboardEvent;
		expect(chordIsClaimed(press, reserved(listing))).toBe(true);
		expect(chordIsClaimed(press, reserved(notListing))).toBe(false);
	});
});
