// @vitest-environment jsdom
// Over a selection, a key is Backspace and then the key exactly when the keymap binds it to a
// command run at the caret the removal leaves: a rebound key works, a disabled one removes nothing.
// Miss-analysis: every command-key row pressed the default chords, which the literal-key claim and
// the keymap agree on, so no row saw them part once a consumer rebinds or disables one.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Seam = { isCrossBlockActive(): boolean };

const SOURCE = 'alpha\n\nbeta\n';
const ACROSS = { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 2 } };

const MOD_1 = { key: '1', ctrlKey: true };
const MOD_ALT_1 = { key: '1', ctrlKey: true, altKey: true };
const ENTER = { key: 'Enter' };
const ALT_ENTER = { key: 'Enter', altKey: true };

type Row = [name: string, key: KeyboardEventInit, keybindings: KeybindingOverride[], after: string];

const ROWS: Row[] = [
	['Mod+1 by default makes the heading', MOD_1, [], '# ata\n'],
	['Mod+1 disabled removes nothing', MOD_1, [{ chord: 'Mod+1', command: null }], SOURCE],
	[
		'the heading command rebound to Mod+Alt+1 makes the heading',
		MOD_ALT_1,
		[{ chord: 'Mod+Alt+1', command: 'heading.cycle', arg: 1 }],
		'# ata\n'
	],
	['Enter by default splits', ENTER, [], 'a\n\nta\n'],
	['Enter disabled removes nothing', ENTER, [{ chord: 'Enter', command: null }], SOURCE],
	[
		'the split rebound to Alt+Enter splits',
		ALT_ENTER,
		[{ chord: 'Alt+Enter', command: 'block.split' }],
		'a\n\nta\n'
	]
];

async function mountWith(keybindings: KeybindingOverride[]): Promise<MountedEditor<Seam>> {
	const mounted = mountEditor<Seam>({ source: SOURCE, keybindings });
	await mounted.settle();
	return mounted;
}

describe('a command key over a range', () => {
	for (const [name, key, keybindings, after] of ROWS) {
		it(name, async () => {
			const mounted = await mountWith(keybindings);
			await mounted.instance.setSelection(ACROSS);
			await mounted.settle();

			await pressKey(surfaceAt(mounted, [1]), key);

			expect(mounted.source()).toBe(after);
			if (after === SOURCE) expect(mounted.instance.__test.isCrossBlockActive()).toBe(true);
		});
	}
});

// Miss-analysis: every binding row above was global, where any kind's answer is every kind's, so
// nothing saw the claim ask a different block than the one the command runs in.
describe('a binding scoped to one kind, over a range', () => {
	const KIND_ROWS: Row[] = [
		[
			'Mod+1 disabled on paragraphs removes nothing',
			MOD_1,
			[{ chord: 'Mod+1', command: null, kind: 'paragraph' }],
			SOURCE
		],
		[
			'Enter disabled on paragraphs removes nothing',
			ENTER,
			[{ chord: 'Enter', command: null, kind: 'paragraph' }],
			SOURCE
		],
		[
			'a split bound to Mod+J on headings does nothing over paragraphs',
			{ key: 'j', ctrlKey: true },
			[{ chord: 'Mod+J', command: 'block.split', kind: 'heading' }],
			SOURCE
		]
	];

	for (const [name, key, keybindings, after] of KIND_ROWS) {
		it(name, async () => {
			const mounted = await mountWith(keybindings);
			await mounted.instance.setSelection(ACROSS);
			await mounted.settle();

			await pressKey(surfaceAt(mounted, [1]), key);

			expect(mounted.source()).toBe(after);
			expect(mounted.instance.__test.isCrossBlockActive()).toBe(true);
		});
	}

	// The removal lands past the rule it takes whole, in the paragraph, which is whose binding counts.
	it('a heading bound to Mod+J on paragraphs runs where a range from a rule lands', async () => {
		const source = '# head\n\n---\n\nbeta\n';
		const mounted = mountEditor<Seam>({
			source,
			keybindings: [{ chord: 'Mod+J', command: 'heading.cycle', arg: 1, kind: 'paragraph' }]
		});
		await mounted.settle();
		await mounted.instance.setSelection({
			anchor: { path: [1], offset: 0 },
			focus: { path: [2], offset: 2 }
		});
		await mounted.settle();

		await pressKey(surfaceAt(mounted, [2]), { key: 'j', ctrlKey: true });

		expect(mounted.source()).toBe('# head\n\n# ta\n');
	});
});

// The block's own keymap dispatch answers a selection inside one block: a rebound chord writes what
// the default one writes, and a disabled one writes nothing.
describe('a command key over a selection inside one block', () => {
	async function pressInside(key: KeyboardEventInit, keybindings: KeybindingOverride[]) {
		const mounted = await mountWith(keybindings);
		const el = surfaceAt(mounted, [0]);
		selectRange(el, 1, 3);
		await pressKey(el, key);
		const after = mounted.source();
		await mounted.destroy();
		return after;
	}

	const PAIRS: [name: string, chord: string, key: KeyboardEventInit, rebound: Row][] = [
		['the heading command', 'Mod+1', MOD_1, ROWS[2]],
		['the split', 'Enter', ENTER, ROWS[5]]
	];

	for (const [name, chord, key, [, reboundKey, rebound]] of PAIRS) {
		it(`${name} rebound writes what ${chord} writes`, async () => {
			expect(await pressInside(reboundKey, rebound)).toBe(await pressInside(key, []));
		});

		it(`${chord} disabled leaves the text`, async () => {
			expect(await pressInside(key, [{ chord, command: null }])).toBe(SOURCE);
		});
	}
});
