// @vitest-environment jsdom
// Text written over a range across blocks lands where a letter typed at the range's start would,
// across a hidden edge, however it arrives: a key, a soft key, a one-line paste, a two-block paste.
// Each row holds both comparators: the range removed by Delete, then the same text at the caret.
// Miss-analysis: every hidden-edge row typed at a caret and every range row started in plain text,
// so the range's one answer, which wrote at the raw offset with no landing block's step, had none.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type BlockLookup,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The bytes `Q` typed over the range leaves, and the bytes `Q⏎⏎R` pasted over it leaves. */
type Landed = [typed: string, pasted: string];

interface Host {
	doc: string;
	anchor: SelectionPoint;
	focus: SelectionPoint;
	live: Landed;
	source: Landed;
}

const LINK = 'a [link](u)\n\nnext\n';
const BOLD = 'a **bold**\n\nnext\n';
const CHIP = 'a `code`\n\nnext\n';

// Live mode moves the text across the hidden edge; source mode shows every byte and moves none.
const HOSTS: Record<string, Host> = {
	'from a link’s end, before its hidden `](u)`': {
		doc: LINK,
		anchor: at([0], 7),
		focus: at([1], 2),
		live: ['a [link](u)Qxt\n', 'a [link](u)Q\n\nRxt\n'],
		source: ['a [linkQxt\n', 'a [linkQ\n\nRxt\n']
	},
	'from a link’s end, drawn backwards': {
		doc: LINK,
		anchor: at([1], 2),
		focus: at([0], 7),
		live: ['a [link](u)Qxt\n', 'a [link](u)Q\n\nRxt\n'],
		source: ['a [linkQxt\n', 'a [linkQ\n\nRxt\n']
	},
	'from a link’s end in a list item': {
		doc: '- a [link](u)\n- b\n\nnext\n',
		anchor: at([0, 0, 0], 7),
		focus: at([1], 2),
		live: ['- a [link](u)Qxt\n', '- a [link](u)Q\n\n  Rxt\n'],
		source: ['- a [linkQxt\n', '- a [linkQ\n\n  Rxt\n']
	},
	'from an autolink’s end': {
		doc: 'a <https://x.example>\n\nnext\n',
		anchor: at([0], 21),
		focus: at([1], 2),
		live: ['a <https://x.example>Qxt\n', 'a <https://x.example>Q\n\nRxt\n'],
		source: ['a <https://x.example>Qxt\n', 'a <https://x.example>Q\n\nRxt\n']
	},
	'from right after an image': {
		doc: 'a ![alt](i.png)\n\nnext\n',
		anchor: at([0], 15),
		focus: at([1], 2),
		live: ['a ![alt](i.png)Qxt\n', 'a ![alt](i.png)Q\n\nRxt\n'],
		source: ['a ![alt](i.png)Qxt\n', 'a ![alt](i.png)Q\n\nRxt\n']
	},
	'from a bold’s end, before its hidden closer': {
		doc: BOLD,
		anchor: at([0], 8),
		focus: at([1], 2),
		live: ['a **boldQ**xt\n', 'a **boldQ**\n\n**R**xt\n'],
		source: ['a **boldQxt\n', 'a **boldQ\n\nRxt\n']
	},
	'from a bold’s end, past its hidden closer': {
		doc: BOLD,
		anchor: at([0], 10),
		focus: at([1], 2),
		live: ['a **boldQ**xt\n', 'a **boldQ**\n\n**R**xt\n'],
		source: ['a **bold**Qxt\n', 'a **bold**Q\n\nRxt\n']
	},
	'from a code chip’s end, inside its border': {
		doc: CHIP,
		anchor: at([0], 7),
		focus: at([1], 2),
		live: ['a `codeQ`xt\n', 'a `codeQ`\n\n`R`xt\n'],
		source: ['a `codeQxt\n', 'a `codeQ\n\nRxt\n']
	},
	'from a code chip’s end, outside its border': {
		doc: CHIP,
		anchor: at([0], 8),
		focus: at([1], 2),
		live: ['a `codeQ`xt\n', 'a `codeQ`\n\n`R`xt\n'],
		source: ['a `code`Qxt\n', 'a `code`Q\n\nRxt\n']
	},
	'to a link’s start in the block after': {
		doc: 'abc\n\n[link](u) d\n',
		anchor: at([0], 2),
		focus: at([1], 1),
		live: ['abQ[link](u) d\n', 'abQ\n\nR[link](u) d\n'],
		source: ['abQlink](u) d\n', 'abQ\n\nRlink](u) d\n']
	},
	'from a divider held whole to the text before a bold': {
		doc: 'abc\n\n***\n\nab**c** z\n',
		anchor: at([1], 0),
		focus: at([2], 2),
		live: ['abc\n\n**Qc** z\n', 'abc\n\n**Q**\n\n**Rc** z\n'],
		source: ['abc\n\nQ**c** z\n', 'abc\n\nQ\n\nR**c** z\n']
	}
};

const MODES: PresentationMode[] = ['live', 'source'];

/** `host` mounted in `mode` with its range drawn. */
async function drawn(host: Host, mode: PresentationMode): Promise<MountedEditor<BlockLookup>> {
	const editor = mountEditor<BlockLookup>({ source: host.doc, presentationMode: mode });
	await editor.instance.setSelection({ anchor: host.anchor, focus: host.focus });
	await editor.settle();
	return editor;
}

const focused = () => document.activeElement as HTMLElement;

/** The range removed by Delete, then `text` put in at the caret the removal left. */
async function afterDelete(host: Host, mode: PresentationMode, text: string): Promise<string> {
	const editor = await drawn(host, mode);
	await deleteBy(surfaceAt(editor, host.focus.path), 'Delete');
	await insertBy(text.includes('\n') ? 'paste' : 'hardware key', focused(), text);
	return editor.source();
}

describe('text over a range across blocks lands where a letter typed at its start would', () => {
	for (const [name, host] of Object.entries(HOSTS))
		for (const mode of MODES) {
			const [typed, pasted] = mode === 'live' ? host.live : host.source;

			for (const route of ['hardware key', 'soft key', 'paste'] as const) {
				it(`${mode}, ${name}, by ${route}`, async () => {
					const editor = await drawn(host, mode);
					await insertBy(route, surfaceAt(editor, host.focus.path), 'Q');
					expect(editor.source()).toBe(typed);

					// The caret sits after the text wherever it was moved, so the next letter follows it.
					await insertBy('hardware key', focused(), 'R');
					expect(editor.source()).toBe(typed.replace('Q', 'QR'));
				});
			}

			it(`${mode}, ${name}, by a paste of two blocks`, async () => {
				const editor = await drawn(host, mode);
				await insertBy('paste', surfaceAt(editor, host.focus.path), 'Q\n\nR');
				expect(editor.source()).toBe(pasted);
			});

			it(`${mode}, ${name}, as Delete and then the same text at the caret`, async () => {
				expect(await afterDelete(host, mode, 'Q')).toBe(typed);
				expect(await afterDelete(host, mode, 'Q\n\nR')).toBe(pasted);
			});
		}

	// Drawing the range moved the caret, which ends a mark a chord pended there.
	it('live, a mark pended before the range was drawn, by every route', async () => {
		for (const route of ['hardware key', 'soft key', 'paste'] as const) {
			const editor = mountEditor({ source: 'a plain\n\nnext\n', presentationMode: 'live' });
			placeCaret(surfaceAt(editor, [0]), 7);
			await pressHardwareKey(surfaceAt(editor, [0]), { key: 'b', ctrlKey: true });
			await editor.instance.setSelection({ anchor: at([0], 7), focus: at([1], 2) });
			await editor.settle();
			await insertBy(route, surfaceAt(editor, [1]), 'Q');
			expect(editor.source(), route).toBe('a plainQxt\n');
			await editor.destroy();
		}
	});
});

/** Counts the holds `path`'s block hands out (`holdInsertion`) and how each was let go. */
function watchHolds(editor: MountedEditor<BlockLookup>, path: number[]) {
	const block = editor.instance.__test.getBlockComponent(path) as BlockComponent;
	const hold = block.holdInsertion!.bind(block);
	const finished: boolean[] = [];
	const holds = vi.spyOn(block, 'holdInsertion').mockImplementation(() => {
		const held = hold();
		return {
			spend: held.spend,
			finish: (changed) => (finished.push(changed), held.finish(changed))
		};
	});
	return { holds, finished };
}

describe('the landing block’s step, asked once per write', () => {
	it('a letter typed at a caret asks no block for it', async () => {
		const editor = mountEditor<BlockLookup>({ source: LINK, presentationMode: 'live' });
		await editor.settle();
		const { holds } = watchHolds(editor, [0]);
		placeCaret(surfaceAt(editor, [0]), 4);
		await insertBy('hardware key', surfaceAt(editor, [0]), 'Q');
		expect(editor.source()).toBe('a [lQink](u)\n\nnext\n');
		expect(holds).not.toHaveBeenCalled();
	});

	for (const route of ['hardware key', 'paste'] as const) {
		it(`a ${route} over the range asks the block it starts in, once, and lets go once`, async () => {
			const host = HOSTS['from a link’s end, before its hidden `](u)`'];
			const editor = await drawn(host, 'live');
			const start = watchHolds(editor, [0]);
			const end = watchHolds(editor, [1]);
			await insertBy(route, surfaceAt(editor, [1]), 'Q');
			expect(editor.source()).toBe(host.live[0]);
			expect(start.holds).toHaveBeenCalledTimes(1);
			expect(start.finished).toEqual([true]);
			expect(end.holds).not.toHaveBeenCalled();
		});
	}

	it('a range from a block held whole asks the block it ends in', async () => {
		const host = HOSTS['from a divider held whole to the text before a bold'];
		const editor = await drawn(host, 'live');
		const end = watchHolds(editor, [2]);
		await insertBy('hardware key', surfaceAt(editor, [2]), 'Q');
		expect(editor.source()).toBe(host.live[0]);
		expect(end.holds).toHaveBeenCalledTimes(1);
	});

	it('Delete over the range writes no text, so asks no block', async () => {
		const host = HOSTS['from a link’s end, before its hidden `](u)`'];
		const editor = await drawn(host, 'live');
		const start = watchHolds(editor, [0]);
		await deleteBy(surfaceAt(editor, [1]), 'Delete');
		expect(editor.source()).toBe('a [link](u)xt\n');
		expect(start.holds).not.toHaveBeenCalled();
	});
});
