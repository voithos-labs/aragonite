// Miss-analysis: GH #265; each plugin-global chord suite used one editor, never asking a second.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	isDefaultGlobalChord,
	resolveBinding,
	resolveGlobalBinding,
	runGlobalChord,
	takesGlobalChord,
	pluginGlobalChords
} from '#lib/schema/commands.js';
import type { CommandDispatchContext } from '#lib/schema/block-commands.js';
import { collectReservedChords } from '#lib/schema/reserved-chords.js';
import type { PluginActivation } from '#lib/schema/plugin-activation.js';
import { command } from '#lib/schema/plugin-command.js';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { commandContext } from '../harness/command-context';
import { valueActivation } from '../harness/value-activation';

const CHORD = 'Mod+Shift+9';

let ran = 0;

const scoped = definePlugin({
	name: 'scoped',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		commands: [command({ id: 'act', title: 'Act', chord: CHORD, run: () => void ran++ })]
	})
});
const listing = valueActivation([scoped]);
const notListing = valueActivation([]);

const chordContext = (activation: PluginActivation): CommandDispatchContext =>
	commandContext({ activation });

beforeEach(() => {
	ran = 0;
});

describe('a plugin-global chord is claimed only where the plugin is activated', () => {
	it('the listing editor resolves the binding and consumes the press', () => {
		expect(resolveGlobalBinding(CHORD, undefined, listing)?.command).toBe('scoped/act');
		expect(resolveBinding(CHORD, 'paragraph', undefined, listing)?.command).toBe('scoped/act');
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

	it("each editor's level enumerates only its own plugins' chords", () => {
		expect(pluginGlobalChords(listing)).toContain(CHORD);
		expect(pluginGlobalChords(notListing)).not.toContain(CHORD);
	});
});

describe('reservedChords answers for the instance that asks', () => {
	const reserved = (activation: PluginActivation) =>
		collectReservedChords({ searchBar: false, activation });

	it('reports the chord to the listing editor and withholds it from the other', () => {
		expect(reserved(listing).has(CHORD)).toBe(true);
		expect(reserved(notListing).has(CHORD)).toBe(false);
	});

	// `claimsChord` asks the same resolver the gap caret and the root dispatch through, so a host
	// asking on each keystroke gets this editor's answer rather than the whole process's.
	it('claimsChord follows it', () => {
		expect(takesGlobalChord(CHORD, chordContext(listing))).toBe(true);
		expect(takesGlobalChord(CHORD, chordContext(notListing))).toBe(false);
	});
});
