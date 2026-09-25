// Miss-analysis: every reserved-chord suite asked with the process-wide activation, so no test
// ever read the set from an editor whose `plugins` prop left a kind-keymap plugin out (GH #288).
import { describe, it, expect, afterEach } from 'vitest';
import { registerBlockCommand } from '$lib/schema/block-commands';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { activationFor, everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { collectReservedChords } from '$lib/schema/reserved-chords';
import { testClosure } from '$lib/test/support/closure';

const CHORD = 'Mod+Shift+8';

/** A one-kind plugin whose kind keymap claims `CHORD`, the shape `mermaid-kind.ts` ships. */
function installKeymapPlugin(name: string): void {
	installPlugins([
		definePlugin({
			name,
			setup() {
				const kind = declarePluginKind(`${name}Block`);
				registerBlockKind(kind, {
					gapEdges: 'none',
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					keymap: [
						{ chord: CHORD, command: registerBlockCommand(kind, `${name}.act`, () => true) }
					],
					closure: testClosure
				});
			}
		})
	]);
}

const reserved = (activation: Parameters<typeof collectReservedChords>[0]['activation']) =>
	collectReservedChords({ searchBar: false, activation });

afterEach(() => {
	__resetSchemaRegistriesForTests();
});

describe("a kind keymap's chord is reserved only where its plugin is activated", () => {
	it('reports the chord to the listing editor and withholds it from the other', () => {
		installKeymapPlugin('listed');

		expect(reserved(activationFor(['listed'])).has(CHORD)).toBe(true);
		expect(reserved(activationFor(['other'])).has(CHORD)).toBe(false);
	});

	it('still reports it process-wide, which is what an editor with no plugins prop asks', () => {
		installKeymapPlugin('listed');

		expect(reserved(everyInstalledPlugin).has(CHORD)).toBe(true);
		expect(reserved(everyInstalledPlugin).has(CHORD)).toBe(true);
	});

	// The filter narrows to plugin kinds: a built-in keymap answers the same to every editor.
	it('leaves the built-in kind chords in both answers', () => {
		installKeymapPlugin('listed');

		expect(reserved(activationFor(['listed'])).has('Mod+B')).toBe(true);
		expect(reserved(activationFor(['other'])).has('Mod+B')).toBe(true);
	});
});
