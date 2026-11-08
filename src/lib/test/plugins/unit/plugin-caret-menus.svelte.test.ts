// @vitest-environment jsdom
// A plugin value's caret menu in a mounted editor: a pick writes nothing until it commits, a
// block lands as its own block, and a waiting pick is its own undo step or nothing.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { menu, type MenuPick, type MenuRow } from '#lib/schema/caret-menu.js';
import type { DraftResult } from '#lib/schema/drafts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** A `/` menu with one row; `onPick` decides what the pick writes. */
function slashPlugin(onPick: (pick: MenuPick) => void | Promise<void>) {
	return definePlugin({
		name: 'slashy',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			menus: [
				menu<MenuRow>({
					label: 'Insert',
					trigger: '/',
					rows: () => [{ label: 'Rule' }],
					pick: (_row, pick) => onPick(pick)
				})
			]
		})
	});
}

/** Types the first block to `before`, then to `text`: the menu reads a trigger off a keystroke
 *  after one it has already seen, as the browser's beforeinput gives it. */
async function type(m: ReturnType<typeof mountEditor>, before: string, text: string) {
	const surface = surfaceAt(m, [0]);
	typeInto(surface, before);
	await m.settle();
	typeInto(surface, text);
	await m.settle();
}

/** Sets the block's text and its caret, as one keystroke does. */
function typeAt(surface: HTMLElement, text: string, caret: number) {
	surface.textContent = text;
	placeCaret(surface, caret);
	surface.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe("a plugin value's caret menu", () => {
	it('lands a block picked inside a line as its own block below the line', async () => {
		const results: Promise<DraftResult>[] = [];
		const m = mountEditor({
			source: 'abc tail\n',
			plugins: [slashPlugin((pick) => void results.push(pick.insertBlock('---\n')))]
		});
		await m.settle();
		const surface = surfaceAt(m, [0]);
		placeCaret(surface, 4);
		typeAt(surface, 'abc  tail', 4);
		await m.settle();
		typeAt(surface, 'abc /ru tail', 7);
		await m.settle();
		await pressKey(surface, { key: 'Enter' });
		await m.settle();

		expect(await results[0]).toEqual({ ok: true });
		// The line keeps its text, the space before the trigger included, and the rule goes below.
		expect(m.source()).toBe('abc  tail\n\n---\n');
		expect(m.instance.getBlockKindAt([1])).toBe('thematicBreak');
	});

	it('replaces an otherwise empty line with the block', async () => {
		const m = mountEditor({
			source: 'x\n',
			plugins: [slashPlugin((pick) => void pick.insertBlock('---\n'))]
		});
		await m.settle();
		await type(m, '', '/ru');
		await pressKey(surfaceAt(m, [0]), { key: 'Enter' });
		await m.settle();

		expect(m.source()).toBe('---\n');
	});

	it('writes nothing while it waits, then lands as its own undo step', async () => {
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		const results: DraftResult[] = [];
		const m = mountEditor({
			source: 'note\n',
			plugins: [
				slashPlugin(async (pick) => {
					await held;
					results.push(await pick.write('[card]'));
				})
			]
		});
		await m.settle();
		await type(m, 'note ', 'note /que');
		await pressKey(surfaceAt(m, [0]), { key: 'Enter' });
		await m.settle();
		expect(m.source()).toBe('note /que\n');

		// Typed right after the query, in the same burst's line: the pick ended that burst.
		typeInto(surfaceAt(m, [0]), 'note /que!!');
		await m.settle();
		release();
		await m.settle();
		expect(results).toEqual([{ ok: true }]);
		expect(m.source()).toBe('note [card]!!\n');

		// The card, the typing after the pick, and the query: three steps back to the start.
		const undo = async () => {
			await pressKey(surfaceAt(m, [0]), { key: 'z', ctrlKey: true });
			await m.settle();
		};
		await undo();
		expect(m.source()).toBe('note /que!!\n');
		await undo();
		expect(m.source()).toBe('note /que\n');
		await undo();
		expect(m.source()).toBe('note\n');
	});

	it('is refused as moved when the query changed while it waited', async () => {
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		const results: DraftResult[] = [];
		const m = mountEditor({
			source: 'note\n',
			plugins: [
				slashPlugin(async (pick) => {
					await held;
					results.push(await pick.write('[card]'));
				})
			]
		});
		await m.settle();
		await type(m, 'note ', 'note /que');
		await pressKey(surfaceAt(m, [0]), { key: 'Enter' });
		await m.settle();
		typeInto(surfaceAt(m, [0]), 'note /q');
		await m.settle();
		release();
		await m.settle();

		expect(results.map((r) => !r.ok && r.reason)).toEqual(['moved']);
		expect(m.source()).toBe('note /q\n');
	});
});
