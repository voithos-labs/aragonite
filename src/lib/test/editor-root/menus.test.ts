// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '#lib/components/editor-root/menus.js';
import type { Misspelling } from '#lib/spell/spell-state.svelte.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { BLOCK_ACTIONS_LABEL, SPELLING_MENU_LABEL } from '#lib/a11y-strings.js';
import { parse } from '#lib/core/parser.js';
import { insertCatalogue } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';

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
		misspelling?: Misspelling;
		suggestions?: readonly string[];
		/** Null answers the first peek, so the rows arrive through the promise. */
		cached?: boolean;
		canAddWord?: boolean;
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
	const replaceWord = vi.fn(async () => true);
	const addWord = vi.fn(async () => {});
	const suggestions = opts.suggestions ?? [];
	const spelling = {
		peekSuggestions: () => (opts.cached === false ? null : suggestions),
		suggestionsFor: async () => suggestions,
		replace: replaceWord,
		canAddWord: opts.canAddWord ?? false,
		addWord
	};
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
		holdsWidget: () => false,
		insertMarkdown,
		aimInsertAtFocus,
		insertCatalogue: () => insertCatalogue(everyInstalledPlugin),
		activation: everyInstalledPlugin,
		reading: fixtureReading(),
		stamps: createDocumentStamps(),
		canEditLinkAtCaret: () => (order.push('ask'), !!opts.editsLink),
		editLinkAtCaret,
		misspellingAtCaret: () => (order.push('spell'), opts.misspelling ?? null),
		spelling,
		getMenu: () => menu,
		setMenu: (next) => (menu = next),
		getBlockElByPath: (path: number[]) => (path[0] === 1 ? prose : null)
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
		replaceWord,
		addWord,
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
		// No editable holds focus, so there is nothing to cut or copy.
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
		expect(h.order).toEqual(['place', 'spell', 'ask']);
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

describe('editor-root menus: a misspelled word under the right-click', () => {
	const misspelling: Misspelling = { path: [1], start: 0, end: 5, word: 'prose' };

	it('puts the suggestions first, then Add to dictionary where the checker takes words, then a divider', () => {
		const h = harness({ misspelling, suggestions: ['prove', 'pose'], canAddWord: true });
		h.rightClick(h.prose);
		expect(h.ids().slice(0, 4)).toEqual(['spell.0', 'spell.1', 'spell.add', 'sep-spell']);
		expect(
			h
				.menu()
				?.items.slice(0, 2)
				.map((item) => item.label)
		).toEqual(['prove', 'pose']);
		expect(h.ids()).toContain('clip.copy');
		// The word is read after the caret is placed, since the caret is what names it.
		expect(h.order.slice(0, 2)).toEqual(['place', 'spell']);
	});

	it('a checker that takes no words gets no Add to dictionary row', () => {
		const h = harness({ misspelling, suggestions: ['prove'] });
		h.rightClick(h.prose);
		expect(h.ids().slice(0, 2)).toEqual(['spell.0', 'sep-spell']);
	});

	it('a word with no suggestions shows one dimmed row saying so', () => {
		const h = harness({ misspelling, suggestions: [] });
		h.rightClick(h.prose);
		const [first] = h.menu()!.items;
		expect(first).toMatchObject({ id: 'spell.none', label: 'No suggestions', disabled: true });
	});

	it('picking a suggestion replaces that word, and Add to dictionary adds it', () => {
		const h = harness({ misspelling, suggestions: ['prove', 'pose'], canAddWord: true });
		h.rightClick(h.prose);
		h.menu()!.pick('spell.1');
		expect(h.replaceWord).toHaveBeenCalledWith(misspelling, 'pose');
		expect(h.menu()).toBeNull();
		h.rightClick(h.prose);
		h.menu()!.pick('spell.add');
		expect(h.addWord).toHaveBeenCalledWith('prose');
	});

	it('suggestions still on their way show a dimmed row, then fill the same menu in', async () => {
		const h = harness({ misspelling, suggestions: ['prove'], cached: false });
		h.rightClick(h.prose);
		expect(h.menu()!.items[0]).toMatchObject({ id: 'spell.pending', disabled: true });
		await Promise.resolve();
		await Promise.resolve();
		expect(h.ids().slice(0, 2)).toEqual(['spell.0', 'sep-spell']);
	});

	it('late suggestions never fill a menu the user has already closed', async () => {
		const h = harness({ misspelling, suggestions: ['prove'], cached: false });
		h.rightClick(h.prose);
		h.menu()!.pick('nothing-here');
		expect(h.menu()).toBeNull();
		await Promise.resolve();
		await Promise.resolve();
		expect(h.menu()).toBeNull();
	});

	it('prose with no misspelled word under the caret gets no spelling rows', () => {
		const h = harness({ suggestions: ['prove'], canAddWord: true });
		h.rightClick(h.prose);
		expect(h.ids().some((id) => id.startsWith('spell.'))).toBe(false);
	});
});

describe('editor-root menus: the spelling menu a hover opens', () => {
	const misspelling: Misspelling = { path: [1], start: 0, end: 5, word: 'prose' };
	const rect = { left: 40, top: 10, right: 70, bottom: 30 } as DOMRect;

	it('shows the spelling rows alone, under the word, anchored to its block', () => {
		const h = harness({ suggestions: ['prove', 'pose'], canAddWord: true });
		const handle = h.menus.openSpellingMenu(misspelling, rect);
		expect(h.ids()).toEqual(['spell.0', 'spell.1', 'spell.add']);
		expect(h.menu()).toMatchObject({ x: 40, y: 34, label: SPELLING_MENU_LABEL });
		expect(handle.isOpen()).toBe(true);
	});

	it('a pick replaces the word and closes; close() closes only its own menu', () => {
		const h = harness({ suggestions: ['prove'] });
		const handle = h.menus.openSpellingMenu(misspelling, rect);
		h.menu()!.pick('spell.0');
		expect(h.replaceWord).toHaveBeenCalledWith(misspelling, 'prove');
		expect(h.menu()).toBeNull();
		expect(handle.isOpen()).toBe(false);
		h.rightClick(h.prose);
		handle.close();
		expect(h.menu()).not.toBeNull();
	});

	it('fills its rows in once late suggestions arrive, and stays the same menu', async () => {
		const h = harness({ suggestions: ['prove'], cached: false });
		const handle = h.menus.openSpellingMenu(misspelling, rect);
		expect(h.ids()).toEqual(['spell.pending']);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.ids()).toEqual(['spell.0']);
		expect(handle.isOpen()).toBe(true);
	});
});
