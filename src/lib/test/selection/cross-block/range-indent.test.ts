// @vitest-environment jsdom
// Tab and Shift+Tab over a live range indent or outdent what it touches, and never delete.
// Miss-analysis: every Tab-over-a-range test pinned "delete, then the key" over prose or a grid, and
// none drew a range over list items, where the list item's own handler took the key a second time.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import type { UndoEntry } from '#lib/undo/types.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';

beforeAll(installLayoutStubs);

type Seam = { getUndoStack(): { undo: UndoEntry[] }; isCrossBlockActive(): boolean };
let mounted: MountedEditor<Seam>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const TAB = { key: 'Tab' };
const SHIFT_TAB = { key: 'Tab', shiftKey: true };

interface PressOptions {
	presses?: number;
	presentationMode?: 'reading';
	keybindings?: KeybindingOverride[];
}

/** Mounts `source`, draws the range, and presses `key` in the block holding the focus. */
async function pressOver(
	source: string,
	selection: EditorSelection,
	key: KeyboardEventInit,
	{ presses = 1, presentationMode, keybindings }: PressOptions = {}
): Promise<void> {
	mounted = mountEditor<Seam>({
		source,
		...(presentationMode ? { presentationMode } : {}),
		...(keybindings ? { keybindings } : {})
	});
	await mounted.instance.setSelection(selection);
	await mounted.settle();
	for (let i = 0; i < presses; i++) {
		const focus = mounted.instance.getSelection()?.focus.path ?? selection.focus.path;
		await pressKey(surfaceAt(mounted, focus), key);
	}
}

const undoDepth = () => mounted.instance.__test.getUndoStack().undo.length;
const rangeLive = () => mounted.instance.__test.isCrossBlockActive();

const SECTION = 'intro\n\nAgreed work\n- alpha\n- beta\n- gamma\n\nLoose ends\n';
// From the end of the last item up to the start of the line above the list, drawn upward.
const OVER_SECTION = { anchor: { path: [2, 2, 0], offset: 5 }, focus: { path: [1], offset: 0 } };

describe('Tab and Shift+Tab over a range that holds list items', () => {
	it('Shift+Tab over a line and a top-level list deletes nothing', async () => {
		await pressOver(SECTION, OVER_SECTION, SHIFT_TAB);

		expect(mounted.source()).toBe(SECTION);
		expect(rangeLive()).toBe(true);
	});

	it('Tab over the same range nests every item but the first', async () => {
		await pressOver(SECTION, OVER_SECTION, TAB);

		expect(mounted.source()).toBe(
			'intro\n\nAgreed work\n- alpha\n  - beta\n  - gamma\n\nLoose ends\n'
		);
	});

	it('Tab over two sibling items nests both, and one undo puts both back', async () => {
		const source = '- alpha\n- beta\n- gamma\n';
		const range = { anchor: { path: [0, 1, 0], offset: 1 }, focus: { path: [0, 2, 0], offset: 2 } };
		await pressOver(source, range, TAB);

		expect(mounted.source()).toBe('- alpha\n  - beta\n  - gamma\n');
		expect(undoDepth()).toBe(1);
		expect(mounted.instance.getSelection()).toEqual({
			anchor: { path: [0, 0, 1, 0, 0], offset: 1 },
			focus: { path: [0, 0, 1, 1, 0], offset: 2 }
		});

		mounted.instance.runCommand('history.undo');
		await mounted.settle();
		expect(mounted.source()).toBe(source);
	});

	it('the range stays selected, so a second Tab nests again', async () => {
		const range = { anchor: { path: [0, 1, 0], offset: 1 }, focus: { path: [0, 2, 0], offset: 2 } };
		await pressOver('- alpha\n- beta\n- gamma\n', range, TAB, { presses: 2 });

		expect(mounted.source()).toBe('- alpha\n  - beta\n    - gamma\n');
		expect(undoDepth()).toBe(2);
	});

	it('Shift+Tab over a range inside a nested list outdents each item once', async () => {
		const range = {
			anchor: { path: [0, 0, 1, 0, 0], offset: 1 },
			focus: { path: [0, 0, 1, 1, 0], offset: 3 }
		};
		await pressOver('- alpha\n  - beta\n  - gamma\n', range, SHIFT_TAB);

		expect(mounted.source()).toBe('- alpha\n- beta\n- gamma\n');
		expect(undoDepth()).toBe(1);
		expect(rangeLive()).toBe(true);
	});

	// `e` could nest under `c` on its own, so a second move would show.
	it('Tab moves an item with the children it holds, which move no further', async () => {
		const range = { anchor: { path: [0, 1, 0], offset: 0 }, focus: { path: [0, 2, 0], offset: 1 } };
		await pressOver('- a\n- b\n  - c\n  - e\n- d\n', range, TAB);

		expect(mounted.source()).toBe('- a\n  - b\n    - c\n    - e\n  - d\n');
	});

	it('Shift+Tab lifts an item with the children it holds, which lift no further', async () => {
		const range = {
			anchor: { path: [0, 0, 1, 0, 0], offset: 0 },
			focus: { path: [0, 0, 1, 0, 1, 1, 0], offset: 1 }
		};
		await pressOver('- a\n  - b\n    - c\n    - e\n', range, SHIFT_TAB);

		expect(mounted.source()).toBe('- a\n- b\n  - c\n  - e\n');
	});

	it('Shift+Tab over items that stop before their last sibling keeps the order', async () => {
		const range = {
			anchor: { path: [0, 0, 1, 0, 0], offset: 1 },
			focus: { path: [0, 0, 1, 1, 0], offset: 2 }
		};
		await pressOver('- alpha\n  - beta\n  - gamma\n  - delta\n', range, SHIFT_TAB);

		expect(mounted.source()).toBe('- alpha\n- beta\n- gamma\n  - delta\n');
	});

	it('a top-level item stays where it is, and its nested item still outdents', async () => {
		const range = {
			anchor: { path: [0, 0, 0], offset: 0 },
			focus: { path: [0, 0, 1, 0, 0], offset: 1 }
		};
		await pressOver('- a\n  - b\n', range, SHIFT_TAB);

		expect(mounted.source()).toBe('- a\n- b\n');
		expect(rangeLive()).toBe(true);
	});

	// A loose nested list parses into one sublist per item, so `gamma` sits after `beta`'s sublist.
	it('Shift+Tab over a loose nested list keeps the order', async () => {
		const range = {
			anchor: { path: [0, 0, 0], offset: 5 },
			focus: { path: [0, 0, 1, 0, 0], offset: 2 }
		};
		await pressOver('- alpha\n\n  - beta\n\n  - gamma\n\n- delta\n', range, SHIFT_TAB);

		expect(mounted.source().match(/alpha|beta|gamma|delta/g)).toEqual([
			'alpha',
			'beta',
			'gamma',
			'delta'
		]);
	});

	it('reading mode takes the key and writes nothing', async () => {
		const source = '- alpha\n- beta\n- gamma\n';
		const range = { anchor: { path: [0, 1, 0], offset: 1 }, focus: { path: [0, 2, 0], offset: 2 } };
		await pressOver(source, range, TAB, { presentationMode: 'reading' });

		expect(mounted.source()).toBe(source);
	});
});

describe('Tab and Shift+Tab over a range with no list item in it', () => {
	it('Tab over two paragraphs changes nothing and keeps the range', async () => {
		const source = 'alpha\n\nbeta\n';
		await pressOver(
			source,
			{ anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 2 } },
			TAB
		);

		expect(mounted.source()).toBe(source);
		expect(undoDepth()).toBe(0);
		expect(rangeLive()).toBe(true);
	});

	it('Shift+Tab over two paragraphs changes nothing', async () => {
		const source = 'alpha\n\nbeta\n';
		const range = { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 2 } };
		await pressOver(source, range, SHIFT_TAB);

		expect(mounted.source()).toBe(source);
	});
});

describe('Tab and Shift+Tab over a range that holds code lines', () => {
	const CODE = '```\none\ntwo\nthree\n```\n\nafter\n';
	// From inside the line `two` down into the paragraph below the fence.
	const FROM_TWO = { anchor: { path: [0], offset: 9 }, focus: { path: [1], offset: 3 } };

	it('Tab indents the code lines the range covers and leaves the prose', async () => {
		await pressOver(CODE, FROM_TWO, TAB);

		expect(mounted.source()).toBe('```\none\n\ttwo\n\tthree\n```\n\nafter\n');
		expect(undoDepth()).toBe(1);
	});

	it('Shift+Tab dedents them', async () => {
		await pressOver('```\none\n\ttwo\n    three\n```\n\nafter\n', FROM_TWO, SHIFT_TAB);

		expect(mounted.source()).toBe(CODE);
	});
});

// Miss-analysis: every range test pressed the literal Tab while each block reads a key by its
// binding, so no test saw the range and the blocks disagree on a rebound key.
describe('a rebound indent key over a range', () => {
	const SIBLINGS = '- alpha\n- beta\n- gamma\n';
	const OVER_TWO = {
		anchor: { path: [0, 1, 0], offset: 1 },
		focus: { path: [0, 2, 0], offset: 2 }
	};
	const MOD_BRACKET = { key: ']', ctrlKey: true };
	const REBINDS: [name: string, keybindings: KeybindingOverride[]][] = [
		['bound on list items', [{ chord: 'Mod+]', command: 'list.indent', kind: 'listItem' }]],
		['bound everywhere', [{ chord: 'Mod+]', command: 'list.indent' }]],
		[
			'bound in place of Tab',
			[
				{ chord: 'Tab', command: null, kind: 'listItem' },
				{ chord: 'Mod+]', command: 'list.indent', kind: 'listItem' }
			]
		]
	];

	for (const [name, keybindings] of REBINDS) {
		it(`Mod+] ${name} nests both items in one undo entry`, async () => {
			await pressOver(SIBLINGS, OVER_TWO, MOD_BRACKET, { keybindings });

			expect(mounted.source()).toBe('- alpha\n  - beta\n  - gamma\n');
			expect(undoDepth()).toBe(1);
			expect(rangeLive()).toBe(true);
		});
	}

	it('Tab with its binding taken off moves nothing and keeps the range', async () => {
		const keybindings = REBINDS[2][1];
		await pressOver(SIBLINGS, OVER_TWO, TAB, { keybindings });

		expect(mounted.source()).toBe(SIBLINGS);
		expect(rangeLive()).toBe(true);
	});
});
