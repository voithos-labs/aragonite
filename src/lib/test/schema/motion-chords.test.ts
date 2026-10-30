// Miss-analysis: the table cell's column chords took Option+Arrow, a Mac's word key, and no test
// read a keymap against the caret keys of the platform it runs on; only a macOS run saw the cell.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	resolveBinding,
	resolveKindBinding,
	resolveGlobalBinding,
	pluginGlobalBinding
} from '#lib/schema/commands.js';
import { registerGlobalCommand } from '#lib/schema/global-commands.js';
import { normalizeKeybindingOverrides } from '#lib/schema/keybinding-overrides.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

/** The platform the editor reads its conventions off, a Mac's for the rest of the test. */
const onMac = () => vi.stubGlobal('navigator', { platform: 'MacIntel' });

afterEach(() => {
	vi.unstubAllGlobals();
});

const resolve = (chord: string, keybindings?: Parameters<typeof normalizeKeybindingOverrides>[0]) =>
	resolveBinding(
		chord,
		'tableCell',
		normalizeKeybindingOverrides(keybindings),
		everyInstalledPlugin
	)?.command ?? null;

describe('the editor’s and plugins’ chords yield to the platform’s caret keys', () => {
	it('on a Mac, the cell’s Option+Arrow column chords yield to the word key', () => {
		onMac();
		for (const chord of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Shift+ArrowLeft']) {
			expect(resolve(chord), chord).toBeNull();
			expect(resolveKindBinding(chord, 'tableCell'), chord).toBeNull();
		}
		// Vertical motion isn't the editor's, so the row move keeps Option+Up.
		expect(resolve('Alt+ArrowUp')).toBe('table.moveRowUp');
	});

	it('elsewhere Alt+Arrow still moves a column', () => {
		expect(resolve('Alt+ArrowLeft')).toBe('table.moveColumnLeft');
		expect(resolve('Alt+Shift+ArrowRight')).toBe('table.insertColumnRight');
	});

	it('a consumer’s own binding on a caret key is honoured, with no warning', () => {
		onMac();
		const own = [{ chord: 'Alt+ArrowRight', command: 'table.moveColumnRight' as const }];
		expect(resolve('Alt+ArrowRight', own)).toBe('table.moveColumnRight');
		const home = normalizeKeybindingOverrides([{ chord: 'Home', command: 'history.undo' }]);
		expect(resolveGlobalBinding('Home', home, everyInstalledPlugin)?.command).toBe('history.undo');
		expect(takeDevWarns()).toEqual([]);
	});

	it('a plugin global chord on a caret key warns at registration and yields', () => {
		onMac();
		registerGlobalCommand('motionChords.word', () => true, { chord: 'Alt+ArrowLeft' });
		expect(takeDevWarns().map((w) => `${w.tag}: ${w.message}`)).toEqual([
			expect.stringMatching(/^keybindings: .*Alt\+ArrowLeft.*never fires/)
		]);
		expect(pluginGlobalBinding('Alt+ArrowLeft', everyInstalledPlugin)).not.toBeNull();
		expect(resolveGlobalBinding('Alt+ArrowLeft', undefined, everyInstalledPlugin)).toBeNull();
	});
});
