// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '$lib/components/editor-root-menus';
import {
	registerDefaultContextActions,
	__resetDefaultContextActionsForTests
} from '$lib/components/menu/default-context-actions';
import { __resetBlockContextActionsForTests } from '$lib/schema/context-actions';
import { BLOCK_ACTIONS_LABEL } from '$lib/a11y-strings';
import { parse } from '$lib/core/parser';
import type { PresentationMode } from '$lib/presentation-mode';

// Miss-analysis: which menu a right-click opens (a block's actions, the clipboard rows with or
// without the insert flyout, or nothing) was pinned only through Playwright, one target per spec.

beforeEach(() => {
	document.body.replaceChildren();
	__resetBlockContextActionsForTests();
	__resetDefaultContextActionsForTests();
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

function harness(opts: { mode?: PresentationMode } = {}) {
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
		deleteBlock: vi.fn(async () => {}),
		updateBlockContent: vi.fn(async () => {}),
		insertParagraph: vi.fn(async () => {})
	};
	const placeCaretAtPoint = vi.fn(() => true);
	const insertMarkdown = vi.fn(() => true);
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
		placeCaretAtPoint,
		insertMarkdown,
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
		placeCaretAtPoint,
		insertMarkdown,
		rightClick,
		ids,
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
		await vi.waitFor(() => expect(h.blockEdit.deleteBlock).toHaveBeenCalledWith(0));
	});

	it('prose places the caret at the press and gets the clipboard rows plus the insert flyout', async () => {
		const h = harness();
		h.rightClick(h.prose.firstElementChild!);
		expect(h.placeCaretAtPoint).toHaveBeenCalledWith(30, 40);
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
		// A flyout pick creates the sibling first, then hands the snippet to whatever it focused.
		h.menu()!.pick('bullet');
		await vi.waitFor(() => expect(h.insertMarkdown).toHaveBeenCalledWith('- '));
		expect(h.blockEdit.insertParagraph).toHaveBeenCalledWith(2, '');
	});

	it('a selection gets the clipboard rows alone, over the selection as it stands', () => {
		const h = harness();
		selectInside(h.prose.firstElementChild!);
		h.rightClick(h.prose.firstElementChild!);
		expect(h.placeCaretAtPoint).not.toHaveBeenCalled();
		expect(h.ids()).not.toContain('insert');
	});

	it('a nested block gets the clipboard rows without the insert flyout', () => {
		const h = harness();
		h.rightClick(h.nested.firstElementChild!);
		expect(h.placeCaretAtPoint).toHaveBeenCalledOnce();
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
