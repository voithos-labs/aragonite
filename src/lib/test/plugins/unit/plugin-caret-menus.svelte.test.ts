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

const slashMenu = (onPick: (pick: MenuPick) => void | Promise<void>) =>
	menu<MenuRow>({
		label: 'Insert',
		trigger: '/',
		rows: () => [{ label: 'Rule' }],
		pick: (_row, pick) => onPick(pick)
	});

/** A `/` menu with one row; `onPick` decides what the pick writes. */
function slashPlugin(onPick: (pick: MenuPick) => void | Promise<void>, slash = slashMenu(onPick)) {
	return definePlugin({
		name: 'slashy',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ menus: [slash] })
	});
}

const undo = async (m: ReturnType<typeof mountEditor>, path = [0]) => {
	await pressKey(surfaceAt(m, path), { key: 'z', ctrlKey: true });
	await m.settle();
};

/** Types ` /q` at the end of `note` in the block at `path` and picks the row. */
async function pickAfterNote(m: ReturnType<typeof mountEditor>, path: number[], query: string) {
	const note = surfaceAt(m, path);
	placeCaret(note, 4);
	typeAt(note, 'note ', 5);
	await m.settle();
	typeAt(note, `note /${query}`, 6 + query.length);
	await m.settle();
	await pressKey(note, { key: 'Enter' });
	await m.settle();
}

/** Writes `!!` at the end of `top` in the first block, as the author would while a pick waits. */
async function writeAbove(m: ReturnType<typeof mountEditor>) {
	const top = surfaceAt(m, [0]);
	placeCaret(top, 3);
	typeAt(top, 'top!!', 5);
	await m.settle();
}

/** A pick that waits until `release` is called. */
function held() {
	let release = () => {};
	const wait = new Promise<void>((resolve) => (release = resolve));
	return { wait, release: () => release() };
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
		await undo(m);
		expect(m.source()).toBe('note /que!!\n');
		await undo(m);
		expect(m.source()).toBe('note /que\n');
		await undo(m);
		expect(m.source()).toBe('note\n');
	});

	// Miss-analysis: the waiting rows typed after the query on its own line, so none moved the
	// caret off the line or wrote above it before the block or the card landed.
	it('lands a waiting block where the query was after the author wrote above it', async () => {
		const gate = held();
		const results: Promise<DraftResult>[] = [];
		const m = mountEditor({
			source: 'top\n\nnote\n',
			plugins: [
				slashPlugin(async (pick) => {
					await gate.wait;
					results.push(pick.insertBlock('> card\n'));
				})
			]
		});
		await m.settle();
		await pickAfterNote(m, [1], 'que');
		await writeAbove(m);
		gate.release();
		await m.settle();

		expect(await results[0]).toEqual({ ok: true });
		expect(m.source()).toBe('top!!\n\nnote \n\n> card\n');
		await undo(m);
		expect(m.source()).toBe('top!!\n\nnote /que\n');
		await undo(m);
		expect(m.source()).toBe('top\n\nnote /que\n');
	});

	it('puts the caret after a waiting write, past what the author wrote above it', async () => {
		const gate = held();
		const results: DraftResult[] = [];
		const m = mountEditor({
			source: 'top\n\nnote\n',
			plugins: [
				slashPlugin(async (pick) => {
					await gate.wait;
					results.push(await pick.write('[c]'));
				})
			]
		});
		await m.settle();
		await pickAfterNote(m, [1], 'q');
		await writeAbove(m);
		gate.release();
		await m.settle();

		expect(results).toEqual([{ ok: true }]);
		expect(m.source()).toBe('top!!\n\nnote [c]\n');
		expect(m.instance.getSelection()?.focus).toMatchObject({ path: [1], offset: 8 });
	});

	it('runs a command after removing the query, one undo step with it', async () => {
		const m = mountEditor({
			source: 'Title\n',
			plugins: [slashPlugin((pick) => void pick.run('heading.cycle', 2))]
		});
		await m.settle();
		await type(m, 'Title ', 'Title /h');
		await pressKey(surfaceAt(m, [0]), { key: 'Enter' });
		await m.settle();

		expect(m.source()).toBe('## Title \n');
		await undo(m);
		expect(m.source()).toBe('Title /h\n');
	});

	// Miss-analysis: the menu rows were keyed by their place in the list, and no row narrowed one.
	it("names a row by its id as the query narrows the list, so a screen reader's row stays put", async () => {
		const letters = menu<MenuRow>({
			label: 'Letters',
			trigger: '/',
			rows: (query) =>
				[
					{ id: 'a', label: 'Alpha' },
					{ id: 'b', label: 'Beta' }
				].filter((row) => row.label.toLowerCase().startsWith(query)),
			pick: () => {}
		});
		const m = mountEditor({ source: 'x\n', plugins: [slashPlugin(() => {}, letters)] });
		await m.settle();
		const betaId = () =>
			[...document.querySelectorAll('[role="option"]')].find((el) =>
				el.textContent?.includes('Beta')
			)?.id;
		await type(m, '', '/');
		const before = betaId();
		await type(m, '/', '/b');

		expect(before).toBeTruthy();
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
		expect(betaId()).toBe(before);
	});

	// Miss-analysis: every block or command row ran on a one-block note or a line with other text,
	// so none emptied a line between two blocks.
	it.each([
		['a block', (pick: MenuPick) => void pick.insertBlock('> q\n'), 'top\n\n> q\n\nend\n'],
		['a command', (pick: MenuPick) => void pick.run('heading.cycle', 1), 'top\n\n# \n\nend\n']
	])('lands %s on an otherwise empty line between two blocks', async (_, onPick, landed) => {
		const m = mountEditor({ source: 'top\n\nx\n\nend\n', plugins: [slashPlugin(onPick)] });
		await m.settle();
		const middle = surfaceAt(m, [1]);
		placeCaret(middle, 1);
		typeAt(middle, '', 0);
		await m.settle();
		typeAt(middle, '/r', 2);
		await m.settle();
		await pressKey(middle, { key: 'Enter' });
		await m.settle();

		expect(m.source()).toBe(landed);
	});

	it('opens by value with the query typed, and not for a menu the editor does not list', async () => {
		const slash = slashMenu(() => {});
		const m = mountEditor({ source: 'x\n', plugins: [slashPlugin(() => {}, slash)] });
		await m.settle();
		await type(m, 'x', '');

		expect(
			m.instance.openMenu(
				slashMenu(() => {}),
				'ru'
			)
		).toBe(false);
		expect(m.instance.openMenu(slash, 'ru')).toBe(true);
		await m.settle();
		expect(m.source()).toBe('/ru\n');
		expect(document.querySelector('[data-inline-menu="slashy"]')).not.toBeNull();
	});

	it.each([
		['a write', (pick: MenuPick) => pick.write('[card]')],
		['a block', (pick: MenuPick) => pick.insertBlock('> card')]
	])(
		'is stale, and refuses %s as moved, when the query changed while it waited',
		async (_, write) => {
			const gate = held();
			const seen: { stale: boolean; result: DraftResult }[] = [];
			const m = mountEditor({
				source: 'note\n',
				plugins: [
					slashPlugin(async (pick) => {
						await gate.wait;
						const stale = pick.stale;
						seen.push({ stale, result: await write(pick) });
					})
				]
			});
			await m.settle();
			await type(m, 'note ', 'note /que');
			await pressKey(surfaceAt(m, [0]), { key: 'Enter' });
			await m.settle();
			typeInto(surfaceAt(m, [0]), 'note /q');
			await m.settle();
			gate.release();
			await m.settle();

			expect(seen.map(({ stale, result }) => [stale, !result.ok && result.reason])).toEqual([
				[true, 'moved']
			]);
			expect(m.source()).toBe('note /q\n');
		}
	);
});
