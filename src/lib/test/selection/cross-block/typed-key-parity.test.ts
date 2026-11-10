// @vitest-environment jsdom
// One answer to "does this keydown type a character": the block's own write beside a widget and a
// range's typing key both read `typesCharacter`, so every key a block would write, the range claims.
// Miss-analysis: the range left typed keys to `beforeinput`, which an engine doesn't send beside a
// widget with no text node, and no row pressed the same keys through the block and the range.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { typesCharacter } from '#lib/schema/keybindings.js';
import {
	decideTypedKey,
	type TypedInsertReads
} from '#lib/components/blocks/editable/typed-insert.js';
import { rangeOwnsKey } from '#lib/selection/cross-block/keydown.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { ADMONITION } from '#packages/admonitions/src/kinds.js';
import type { PluginBlockKind } from '#lib/plugin.js';
import type { PluginCommandId } from '#lib/schema/command-id.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { makeKeydownEnv } from './keydown-env';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	vi.unstubAllGlobals();
});

const ALT_GRAPH = { modifierAltGraph: true } as KeyboardEventInit;

// Each keydown with whether it types its character off a Mac and on one.
const SHAPES: [name: string, init: KeyboardEventInit, offMac: boolean, onMac: boolean][] = [
	['a letter', { key: 'a' }, true, true],
	['a space', { key: ' ' }, true, true],
	['Shift and a letter', { key: 'A', shiftKey: true }, true, true],
	['a character outside the BMP', { key: '😀' }, true, true],
	['Ctrl and a letter', { key: 'a', ctrlKey: true }, false, false],
	['Meta and a letter', { key: 'a', metaKey: true }, false, false],
	['Alt and a letter, a shortcut off a Mac', { key: 'a', altKey: true }, false, true],
	['Option and the character it types', { key: 'å', altKey: true }, false, true],
	// On a Mac Ctrl is a command whatever AltGr state an engine reports beside it.
	[
		'AltGr as Windows reports it',
		{ key: '@', ctrlKey: true, altKey: true, ...ALT_GRAPH },
		true,
		false
	],
	['AltGr as Linux reports it', { key: '@', ...ALT_GRAPH }, true, true],
	['Ctrl+Alt with no AltGr state', { key: '@', ctrlKey: true, altKey: true }, true, false],
	['Cmd with Option', { key: 'å', metaKey: true, altKey: true }, false, false],
	['the IME’s Process key', { key: 'Process', keyCode: 229 } as KeyboardEventInit, false, false],
	['a dead key', { key: 'Dead' }, false, false],
	['an unidentified key', { key: 'Unidentified', keyCode: 229 } as KeyboardEventInit, false, false],
	['Enter', { key: 'Enter' }, false, false],
	['an arrow', { key: 'ArrowLeft' }, false, false]
];

/** A block caret in no text node beside a widget, the spot the block writes a key itself. */
function besideWidget(): TypedInsertReads {
	const el = document.createElement('div');
	return {
		composing: () => false,
		el: () => el,
		caretPosition: () => ({ node: el, offset: 0 }),
		caret: () => 0,
		rawStartOf: () => 0,
		onOpenLine: () => false,
		writes: {
			widgetBeside: () => true,
			widgetClosesAt: () => false,
			typeAt: () => {}
		}
	};
}

const keydown = (init: KeyboardEventInit) =>
	new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe.each([
	['off a Mac', 'Win32'],
	['on a Mac', 'MacIntel']
])('a keydown %s', (_, platform) => {
	for (const [name, init, offMac, onMac] of SHAPES) {
		const types = platform === 'MacIntel' ? onMac : offMac;
		it(`${name} ${types ? 'types' : 'types nothing'}, and a range claims what a block writes`, () => {
			vi.stubGlobal('navigator', { platform });
			expect(typesCharacter(keydown(init))).toBe(types);
			expect(decideTypedKey(keydown(init), besideWidget())).toBe(types);

			const env = makeKeydownEnv('alpha\n\nbeta\n', { myPath: [1] });
			env.selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 2 });
			if (types) expect(rangeOwnsKey(keydown(init), env.ctx)).toBe(true);
		});
	}
});

// Miss-analysis: the parity rows bound no chord, so a Ctrl+Alt chord the keymap binds, which off a
// Mac reads as AltGr, was typed over the range instead of running its command.
describe('a chord the keymap binds over a range', () => {
	it('runs its command rather than typing, though off a Mac it reads as AltGr', async () => {
		vi.stubGlobal('navigator', { platform: 'Win32' });
		const env = makeKeydownEnv('alpha\n\nbeta\n', {
			myPath: [1],
			keybindings: [{ chord: 'Mod+Alt+G', command: 'format.toggleStrong' }]
		});
		env.selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 2 });
		await env.keydown.handleKeyDown(keydown({ key: 'g', ctrlKey: true, altKey: true }));
		expect(env.source()).toBe('alpha\n\nbeta\n');
	});

	// Miss-analysis: the bound-chord row bound the leaf's keymap, and a container's binding is
	// read by its own walk after the block's keys, which a typed range never reached.
	it('runs a container’s command, as at a caret', async () => {
		vi.stubGlobal('navigator', { platform: 'Win32' });
		const editor = mountEditor({
			source: ':::note\na1\n\nb2\n:::\n',
			plugins: [admonitionsPlugin()],
			keybindings: [
				{
					kind: ADMONITION as PluginBlockKind,
					chord: 'Mod+Alt+7',
					command: 'admonition.cycleKind' as PluginCommandId
				}
			]
		});
		await editor.settle();
		await editor.instance.setSelection({
			anchor: { path: [0, 1], offset: 1 },
			focus: { path: [0, 2], offset: 1 }
		});
		await editor.settle();
		await pressKey(surfaceAt(editor, [0, 2]), { key: '7', ctrlKey: true, altKey: true });
		expect(editor.source()).toBe(':::tip\na1\n\nb2\n:::\n');
	});
});
