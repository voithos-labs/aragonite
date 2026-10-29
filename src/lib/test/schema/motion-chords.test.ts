// Miss-analysis: the table cell's column chords took Option+Arrow, a Mac's word key, and no test
// read a keymap against the caret keys of the platform it runs on; only a macOS run saw the cell.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBinding, resolveKindBinding, resolveGlobalBinding } from '#lib/schema/commands.js';
import { normalizeKeybindingOverrides } from '#lib/schema/keybinding-overrides.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

/** The platform the editor reads its conventions off, a Mac's for the rest of the test. */
const onMac = () => vi.stubGlobal('navigator', { platform: 'MacIntel' });

afterEach(() => {
	vi.unstubAllGlobals();
});

const resolve = (chord: string) =>
	resolveBinding(chord, 'tableCell', undefined, everyInstalledPlugin)?.command ?? null;

describe('a caret key of the platform is no keymap chord', () => {
	it('on a Mac, Option+Arrow and its Shift twin are word keys in a table cell', () => {
		onMac();
		for (const chord of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Shift+ArrowLeft']) {
			expect(resolve(chord), chord).toBeNull();
			expect(resolveKindBinding(chord, 'tableCell'), chord).toBeNull();
		}
		// Vertical motion isn't the editor's, so the row move keeps Option+Up.
		expect(resolve('Alt+ArrowUp')).toBe('table.moveRowUp');
	});

	it('elsewhere Alt+Arrow still moves a column, and Ctrl+Arrow is the word key', () => {
		expect(resolve('Alt+ArrowLeft')).toBe('table.moveColumnLeft');
		expect(resolve('Alt+Shift+ArrowRight')).toBe('table.insertColumnRight');
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+ArrowLeft', command: 'history.undo' }
		]);
		takeDevWarns();
		expect(resolveGlobalBinding('Mod+ArrowLeft', overrides, everyInstalledPlugin)).toBeNull();
	});

	it('a consumer binding on a caret key is dropped with a dev warning', () => {
		onMac();
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Alt+ArrowRight', command: 'history.undo' },
			{ chord: 'Alt+ArrowUp', command: 'history.undo' }
		]);
		expect(
			takeDevWarns()
				.map((w) => w.message)
				.join('\n')
		).toContain('Alt+ArrowRight');
		expect(resolveGlobalBinding('Alt+ArrowRight', overrides, everyInstalledPlugin)).toBeNull();
		expect(resolveGlobalBinding('Alt+ArrowUp', overrides, everyInstalledPlugin)?.command).toBe(
			'history.undo'
		);
	});
});
