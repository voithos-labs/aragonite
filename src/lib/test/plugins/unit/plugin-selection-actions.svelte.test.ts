// @vitest-environment jsdom
// A plugin value's selection actions in a mounted editor: one capture for the right-click menu and
// `openRows`, rows asked only when one opens, and a draft opened at the pick that the menu's
// closing refuses. The toolbar's row is `decorations/selection-toolbar.spec.ts`, since jsdom
// never places the bar.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { definePlugin } from '#lib/schema/plugin-install.js';
import type { ActionRow, Captured, SelectionAction } from '#lib/schema/selection-action.js';
import type { DraftResult } from '#lib/schema/drafts.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import { cellPoint } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const withActions = (...actions: SelectionAction[]) =>
	definePlugin({
		name: 'acts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ selectionActions: actions })
	});

/** The open block menu's row labels, dividers as `|`. */
const menuRows = () =>
	[...document.querySelectorAll('.block-menu .md-menu-item, .block-menu .md-menu-divider')].map(
		(el) => (el.classList.contains('md-menu-divider') ? '|' : (el.textContent ?? '').trim())
	);
const menuRow = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('.block-menu .md-menu-item')].find(
		(el) => el.textContent?.trim() === label
	);

/** The word around byte `at` of `abc def ghi`. */
const wordAt = (text: string, at: number) => {
	let from = at;
	let to = at;
	while (from > 0 && /\w/.test(text[from - 1])) from--;
	while (to < text.length && /\w/.test(text[to])) to++;
	return from < to ? { from, to } : null;
};

function rightClick(m: ReturnType<typeof mountEditor>) {
	surfaceAt(m, [0]).dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
	);
}

describe('selection action rows in the right-click menu', () => {
	it('captures the selection by default, and puts a lead group first with a divider', async () => {
		const seen: Captured[] = [];
		const trailing: SelectionAction = {
			label: 'Shout',
			rows: (captured) => (seen.push(captured), [{ label: 'Upper', run: () => {} }])
		};
		const lead: SelectionAction = {
			label: 'Spell',
			lead: true,
			rows: () => [{ label: 'Fix', run: () => {} }]
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(trailing, lead)] });
		await m.settle();
		selectRange(surfaceAt(m, [0]), 4, 7);
		await m.settle();
		rightClick(m);
		await m.settle();

		expect(seen.map(({ text, range }) => [text, range])).toEqual([['def', { from: 4, to: 7 }]]);
		const rows = menuRows();
		expect(rows.slice(0, 2)).toEqual(['Fix', '|']);
		expect(rows.indexOf('Upper')).toBeGreaterThan(rows.indexOf('Copy'));
	});

	// The spellcheck shape: the word under a bare caret, rows that come late, the group first.
	it('shows a lead group captured at a caret first, pending until its rows come', async () => {
		let release = (_rows: readonly ActionRow[]) => {};
		const spell: SelectionAction = {
			label: 'Spelling',
			lead: true,
			capture: (_editor, { from }) => wordAt('abc def ghi', from),
			rows: () => new Promise((resolve) => (release = resolve))
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(spell)] });
		await m.settle();
		selectRange(surfaceAt(m, [0]), 5, 5);
		await m.settle();
		rightClick(m);
		await m.settle();
		expect(menuRows().slice(0, 2)).toEqual(['Loading…', '|']);

		release([{ label: 'deaf', run: () => {} }]);
		await m.settle();
		expect(menuRows().slice(0, 2)).toEqual(['deaf', '|']);
	});

	// Miss-analysis: the rule had a sentence and no row: the byte read it rode on said null for
	// cells, and the row that replaced that read holds only a caret and a range of text.
	it.each([
		['table cells', cellPoint([1], 0), cellPoint([1], 3)],
		['a range from text into a cell', { path: [0], offset: 1 }, cellPoint([1], 3)]
	])('offers no row over %s', async (_, anchor, focus) => {
		const seen: Captured[] = [];
		const shout: SelectionAction = {
			label: 'Shout',
			rows: (captured) => (seen.push(captured), [{ label: 'Upper', run: () => {} }])
		};
		const source = 'abc def\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
		const m = mountEditor({ source, plugins: [withActions(shout)] });
		await m.settle();
		await m.instance.setSelection({ anchor, focus });
		await m.settle();
		rightClick(m);
		await m.settle();
		expect([seen, menuRows().includes('Upper')]).toEqual([[], false]);
	});

	it('captures nothing at a bare caret unless the action captures a range there', async () => {
		const plain: SelectionAction = { label: 'Plain', rows: () => [{ label: 'P', run: () => {} }] };
		const word: SelectionAction = {
			label: 'Word',
			capture: (_editor, { from }) => wordAt('abc def ghi', from),
			rows: (captured) => [{ label: `W ${captured.text}`, run: () => {} }]
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(plain, word)] });
		await m.settle();
		selectRange(surfaceAt(m, [0]), 5, 5);
		await m.settle();
		rightClick(m);
		await m.settle();

		expect(menuRows()).toContain('W def');
		expect(menuRows()).not.toContain('P');
	});
});

describe('openRows', () => {
	it('opens the editor menu with the rows at the anchor, and closes it again', async () => {
		let asked = 0;
		const action: SelectionAction = {
			label: 'Word',
			rows: () => (asked++, [{ label: 'One', run: () => {} }])
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();

		const open = m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		expect(open.isOpen).toBe(true);
		expect(menuRows()).toEqual(['One']);
		expect(asked).toBe(1);

		open.close();
		await m.settle();
		expect(open.isOpen).toBe(false);
		expect(menuRows()).toEqual([]);
	});

	it('shows a pending row while promised rows come, then the rows', async () => {
		let release = (_rows: readonly ActionRow[]) => {};
		const action: SelectionAction = {
			label: 'Word',
			rows: () => new Promise((resolve) => (release = resolve))
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		expect(menuRows()).toEqual(['Loading…']);

		release([{ label: 'Late', run: () => {} }]);
		await m.settle();
		expect(menuRows()).toEqual(['Late']);
	});

	it('names the pending row as the action does', async () => {
		const action: SelectionAction = {
			label: 'Word',
			pending: 'Finding words…',
			rows: () => new Promise(() => {})
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		expect(menuRows()).toEqual(['Finding words…']);
	});
});

describe('rows opened over a range', () => {
	it('tell their opener as the pointer comes onto the menu and leaves it', async () => {
		const action: SelectionAction = { label: 'Word', rows: () => [{ label: 'W', run: () => {} }] };
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		const seen: boolean[] = [];
		m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 }, (on) => seen.push(on));
		await m.settle();
		const menu = document.querySelector('.block-menu')!;
		menu.dispatchEvent(new PointerEvent('pointerenter'));
		menu.dispatchEvent(new PointerEvent('pointerleave'));
		expect(seen).toEqual([true, false]);
	});

	// Missed: every openRows row passed a point, so a rect's placement and the menu's name went unread.
	it('open a little under a rect, named for their action', async () => {
		const action: SelectionAction = { label: 'Word', rows: () => [{ label: 'W', run: () => {} }] };
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		m.instance.openRows(action, { from: 4, to: 7 }, new DOMRect(10, 20, 30, 16));
		await m.settle();
		const menu = document.querySelector<HTMLElement>('.block-menu')!;
		expect([menu.style.left, menu.style.top, menu.getAttribute('aria-label')]).toEqual([
			'10px',
			'40px',
			'Word'
		]);
	});

	// Missed: no row scrolled with the rows open, so rows pinned to the viewport passed.
	it('follow the block holding their range through a scroll', async () => {
		const action: SelectionAction = { label: 'Word', rows: () => [{ label: 'W', run: () => {} }] };
		const m = mountEditor({ source: 'abc\n\ndef ghi\n', plugins: [withActions(action)] });
		await m.settle();
		// Only the second paragraph moves when the page scrolls.
		let scrolled = 0;
		const rect = vi
			.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
			.mockImplementation(function (this: HTMLElement) {
				const top = this.closest(`[data-block-path='[1]']`) ? 100 - scrolled : 0;
				return new DOMRect(0, top, 200, 20);
			});
		try {
			m.instance.openRows(action, { from: 5, to: 8 }, { x: 10, y: 120 });
			await m.settle();
			scrolled = 60;
			window.dispatchEvent(new Event('scroll'));
			flushSync();
			expect(document.querySelector<HTMLElement>('.block-menu')!.style.top).toBe('60px');
		} finally {
			rect.mockRestore();
		}
	});
});

describe('a picked row', () => {
	it('writes through a draft opened at the pick, as one undo step', async () => {
		let range = { from: 0, to: 0 };
		const action: SelectionAction = {
			label: 'Shout',
			rows: (captured) => (
				(range = { ...captured.range }),
				[
					{
						label: 'Upper',
						run: (draft) => void draft.replace(range, captured.text.toUpperCase()).commit()
					}
				]
			)
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		menuRow('Upper')!.click();
		flushSync();
		await m.settle();

		expect(m.source()).toBe('abc DEF ghi\n');
		expect(menuRows()).toEqual([]);
	});

	it('keeps the menu open while its run waits, and refuses its write as closed once the menu goes', async () => {
		let release = () => {};
		const results: DraftResult[] = [];
		const action: SelectionAction = {
			label: 'Slow',
			rows: () => [
				{
					label: 'Fetch',
					run: async (draft) => {
						await new Promise<void>((resolve) => (release = resolve));
						results.push(await draft.replace({ from: 4, to: 7 }, 'X').commit());
					}
				}
			]
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(action)] });
		await m.settle();
		const open = m.instance.openRows(action, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		menuRow('Fetch')!.click();
		flushSync();
		await m.settle();
		expect(open.isOpen).toBe(true);
		expect(menuRow('Fetch')!.disabled).toBe(true);

		open.close();
		release();
		await m.settle();
		expect(results.map((r) => !r.ok && r.reason)).toEqual(['closed']);
		expect(m.source()).toBe('abc def ghi\n');
	});
});

describe('icons', () => {
	it('draws an action row given as SVG markup, and leaves out a plugin naming an unknown glyph', async () => {
		const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>';
		const drawn: SelectionAction = {
			label: 'Dot',
			rows: () => [{ label: 'Dot', icon: { svg }, run: () => {} }]
		};
		const m = mountEditor({ source: 'abc def ghi\n', plugins: [withActions(drawn)] });
		await m.settle();
		m.instance.openRows(drawn, { from: 4, to: 7 }, { x: 10, y: 20 });
		await m.settle();
		expect(menuRow('Dot')!.querySelector('circle')).not.toBeNull();

		const errors: PluginError[] = [];
		const bad = { label: 'Bad', icon: 'no-such-glyph', rows: () => [] } as never as SelectionAction;
		const other = mountEditor({
			source: 'x\n',
			plugins: [withActions(bad)],
			onError: (e) => errors.push(e)
		});
		await other.settle();
		expect(other.instance.plugins).toEqual([]);
		expect(String((errors[0].cause as Error).message)).toMatch(/no-such-glyph/);
	});
});
