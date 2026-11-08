// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '#lib/components/editor-root/menus.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { BLOCK_ACTIONS_LABEL } from '#lib/a11y-strings.js';
import { parse } from '#lib/core/parser.js';
import { insertCatalogue } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

// Miss-analysis: which menu a right-click opens was tested only through Playwright.

beforeEach(() => {
	document.body.replaceChildren();
	registerDefaultContextActions();
});

function hostAt(path: number[]): HTMLElement {
	const host = document.createElement('div');
	host.className = 'block-host';
	host.setAttribute('data-block-path', JSON.stringify(path));
	const content = document.createElement('p');
	content.textContent = 'text';
	host.append(content);
	return host;
}

/** `rangeAtPress` stands in for the record of the right button's press; absent, the live selection. */
function harness(
	opts: {
		mode?: PresentationMode;
		editsLink?: boolean;
		rangeAtPress?: boolean;
		finger?: boolean;
	} = {}
) {
	const root = document.createElement('div');
	const header = document.createElement('div');
	const headerField = document.createElement('p');
	header.append(headerField);
	const doc = parse('```\ncode\n```\n\nprose here\n');
	const fence = hostAt([0]);
	const prose = hostAt([1]);
	const nested = hostAt([1, 0]);
	prose.append(nested);
	const menuRow = document.createElement('div');
	menuRow.className = 'md-menu';
	root.append(header, fence, prose, menuRow);
	document.body.append(root);

	let menu: BlockMenuModel | null = null;
	const blockEdit = {
		deleteBlock: vi.fn(async () => true),
		replaceRaw: vi.fn(async () => true)
	};
	const placeMenuCaret = vi.fn(() => true);
	const insertMarkdown = vi.fn(async () => true);
	const aimedInserts: string[] = [];
	const aimInsertAtFocus = vi.fn(() => ({
		markdown: async (md: string) => (aimedInserts.push(md), true),
		plainText: async (text: string) => (aimedInserts.push(`plain:${text}`), true)
	}));
	const order: string[] = [];
	placeMenuCaret.mockImplementation(() => (order.push('place'), true));
	const editLinkAtCaret = vi.fn();
	const selection = createSelectionState();
	const menus = createRootMenus({
		get editorEl() {
			return root;
		},
		get mode() {
			return opts.mode ?? 'source';
		},
		getDoc: () => doc,
		isHostChrome: (node) => !!node && header.contains(node),
		blockEdit,
		placeMenuCaret,
		rangeAtContextPress: () => opts.rangeAtPress ?? !(window.getSelection()?.isCollapsed ?? true),
		selection,
		finger: () => opts.finger ?? false,
		insertMarkdown,
		clipboard: { take: () => null, pasteTarget: aimInsertAtFocus },
		insertCatalogue: () => insertCatalogue(everyInstalledPlugin),
		activation: everyInstalledPlugin,
		reading: fixtureReading(),
		stamps: createDocumentStamps(),
		canEditLinkAtCaret: () => (order.push('ask'), !!opts.editsLink),
		editLinkAtCaret,
		setMenu: (next) => (menu = next)
	});
	root.addEventListener('contextmenu', menus.onRootContextMenu);

	const rightClick = (target: Element, init: MouseEventInit = {}) => {
		const event = new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 30,
			clientY: 40,
			...init
		});
		target.dispatchEvent(event);
		return event;
	};
	const ids = () => menu?.items.map((item) => item.id) ?? [];
	return {
		fence,
		prose,
		nested,
		headerField,
		menuRow,
		menus,
		blockEdit,
		placeMenuCaret,
		insertMarkdown,
		aimInsertAtFocus,
		aimedInserts,
		rightClick,
		ids,
		order,
		editLinkAtCaret,
		selection,
		menu: () => menu
	};
}

function selectInside(el: Element): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

describe('editor-root menus: the right-click', () => {
	it("a block opens its kind's actions, and a pick runs through the block-edit bundle", async () => {
		const h = harness();
		expect(h.rightClick(h.fence.firstElementChild!).defaultPrevented).toBe(true);
		expect(h.menu()?.label).toBe(BLOCK_ACTIONS_LABEL);
		expect(h.ids()).toContain('block.remove');
		h.menu()!.pick('block.remove');
		expect(h.menu()).toBeNull();
		// No key, so the caret goes to the end of the block above.
		await vi.waitFor(() => expect(h.blockEdit.deleteBlock).toHaveBeenCalledWith(0, 'keyless'));
	});

	// Android hands a long press's contextmenu to the page; the editor takes the word over and its
	// toolbar is the menu, so this one cancels the browser's and opens nothing of its own.
	it("a finger's long press opens no menu and cancels the browser's", () => {
		const h = harness({ finger: true });
		const event = h.rightClick(h.prose.firstElementChild!);
		expect(event.defaultPrevented).toBe(true);
		expect(h.menu()).toBeNull();
		expect(h.placeMenuCaret).not.toHaveBeenCalled();
	});

	it('prose places the caret at the press and gets the clipboard rows plus the insert flyout', async () => {
		const h = harness();
		h.rightClick(h.prose.firstElementChild!);
		expect(h.placeMenuCaret).toHaveBeenCalledWith(30, 40);
		expect(h.ids()).toEqual([
			'clip.cut',
			'clip.copy',
			'clip.paste',
			'clip.paste-plain',
			'sep',
			'insert'
		]);
		// Nothing is selected, so there is nothing to cut or copy.
		expect(h.menu()!.items[0].disabled).toBe(true);
		// A flyout pick inserts below the block the press placed the caret in.
		h.menu()!.pick('bullet');
		expect(h.insertMarkdown).toHaveBeenCalledWith('- ', { placement: 'below' });
	});

	it('Paste aims at the focused block as it is picked, then inserts the clipboard text there', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => 'pasted' },
			configurable: true
		});
		const h = harness();
		h.rightClick(h.prose.firstElementChild!);
		h.menu()!.pick('clip.paste');
		// Aimed before the clipboard read awaits, so a focus move during it cannot redirect the text.
		expect(h.aimInsertAtFocus).toHaveBeenCalledOnce();
		expect(h.aimedInserts).toEqual([]);
		await vi.waitFor(() => expect(h.aimedInserts).toEqual(['pasted']));
		expect(h.insertMarkdown).not.toHaveBeenCalled();
	});

	it('over a link, prose leads with Edit link, asked after the caret lands, and runs it', () => {
		const h = harness({ editsLink: true });
		h.rightClick(h.prose.firstElementChild!);
		expect(h.order).toEqual(['place', 'ask']);
		expect(h.ids().slice(0, 3)).toEqual(['link.edit', 'sep-edit', 'clip.cut']);
		expect(h.menu()!.items[0].label).toBe('Edit link');

		h.menu()!.pick('link.edit');
		expect(h.menu()).toBeNull();
		expect(h.editLinkAtCaret).toHaveBeenCalledOnce();
	});

	it('a selection gets the clipboard rows alone, over the selection as it stands', () => {
		const h = harness();
		selectInside(h.prose.firstElementChild!);
		h.rightClick(h.prose.firstElementChild!);
		expect(h.placeMenuCaret).not.toHaveBeenCalled();
		expect(h.ids()).not.toContain('insert');
	});

	// Miss-analysis: every right-click row read the selection at contextmenu, and no browser the
	// suite drives selects under a right-click the way Safari does.
	it('a press made on no range opens block actions over the word the browser then selected', () => {
		const h = harness({ rangeAtPress: false });
		selectInside(h.fence.firstElementChild!);
		h.rightClick(h.fence.firstElementChild!);
		expect(h.menu()?.label).toBe(BLOCK_ACTIONS_LABEL);
		expect(h.ids()).toContain('block.remove');
		// The caret replaces the word, which would otherwise linger under the block's actions.
		expect(h.placeMenuCaret).toHaveBeenCalledWith(30, 40);
	});

	it.each([
		['keeps a word the browser selected under the pointer', true],
		['places the caret over a range that lies elsewhere', false]
	])('the same press on prose %s, and offers the flyout', (_, covers) => {
		const h = harness({ rangeAtPress: false });
		selectInside(h.prose.firstElementChild!);
		const rects = covers ? [new DOMRect(0, 0, 100, 100)] : [];
		const original = Range.prototype.getClientRects;
		Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
		try {
			h.rightClick(h.prose.firstElementChild!);
		} finally {
			Range.prototype.getClientRects = original;
		}
		expect(h.placeMenuCaret).toHaveBeenCalledTimes(covers ? 0 : 1);
		expect(h.ids()).toContain('insert');
	});

	// Miss-analysis: #820, every row selected inside one block, where the browser holds the range;
	// under a range the editor holds, the browser's selection is a caret.
	describe('over a range the editor holds', () => {
		const across = (h: ReturnType<typeof harness>) =>
			h.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
		const row = (h: ReturnType<typeof harness>, id: string) =>
			h.menu()!.items.find((item) => item.id === id);

		it('a press on it opens Cut and Copy over it, with no flyout', () => {
			const h = harness({ rangeAtPress: true });
			across(h);
			h.rightClick(h.prose.firstElementChild!);
			expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
			expect(row(h, 'clip.cut')?.disabled).toBe(false);
			expect(row(h, 'clip.copy')?.disabled).toBe(false);
			expect(h.ids()).not.toContain('insert');
			expect(h.placeMenuCaret).not.toHaveBeenCalled();
		});

		it("a press off it on a block's own actions puts the caret there", () => {
			const h = harness({ rangeAtPress: false });
			across(h);
			h.rightClick(h.fence.firstElementChild!);
			expect(h.menu()?.label).toBe(BLOCK_ACTIONS_LABEL);
			expect(h.placeMenuCaret).toHaveBeenCalledWith(30, 40);
		});
	});

	it('G1.175 a menu opened over a selection that nothing holds fails the dev check', () => {
		const h = harness({ rangeAtPress: true });
		h.rightClick(h.prose.firstElementChild!);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:menu-over-selection']);
	});

	it('a nested block gets the clipboard rows without the insert flyout', () => {
		const h = harness();
		h.rightClick(h.nested.firstElementChild!);
		expect(h.placeMenuCaret).toHaveBeenCalledOnce();
		expect(h.ids()).toContain('clip.paste');
		expect(h.ids()).not.toContain('insert');
	});

	it('reading mode and host chrome keep the browser menu', () => {
		const reading = harness({ mode: 'reading' });
		expect(reading.rightClick(reading.fence).defaultPrevented).toBe(false);
		expect(reading.menu()).toBeNull();
		const h = harness();
		expect(h.rightClick(h.headerField).defaultPrevented).toBe(false);
		expect(h.menu()).toBeNull();
	});

	it('a block path that parses but is no path opens nothing', () => {
		const h = harness();
		h.fence.setAttribute('data-block-path', '{"0":1}');
		h.rightClick(h.fence.firstElementChild!);
		expect(h.menu()).toBeNull();
	});

	it("an already-claimed event and a press on a menu's own row open nothing", () => {
		const h = harness();
		const claimed = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		claimed.preventDefault();
		h.fence.dispatchEvent(claimed);
		expect(h.menu()).toBeNull();
		expect(h.rightClick(h.menuRow).defaultPrevented).toBe(true);
		expect(h.menu()).toBeNull();
	});
});
