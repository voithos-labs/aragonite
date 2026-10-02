// @vitest-environment jsdom
// A mode change and a document swap close every open menu, since a menu offers the edits of the
// mode and the document it opened over.
// Miss-analysis: the one mode-change test opened only the block menu, which the editor closed by
// name; the table menu stayed open, and the code gutter's menu closed only if focus sat in it.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { CODE_MENU_LABEL } from '$lib/a11y-strings';
import { registerDefaultContextActions } from '$lib/components/menu/default-context-actions';
import type { PresentationMode } from '$lib/presentation-mode';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressInCell } from '../blocks/table/mount-table';

beforeAll(installLayoutStubs);
beforeEach(registerDefaultContextActions);
afterEach(destroyMountedEditors);

const DOC = 'see [x](https://e.c) now\n\n```js\ncode\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
const FENCE = [1];
const TABLE = [2];

interface MenuKind {
	name: string;
	/** The menu's own root element, gone once it closes. */
	selector: string;
	open(mounted: MountedEditor): Promise<void>;
}

function click(el: Element | null, what: string): void {
	if (!(el instanceof HTMLElement)) throw new Error(`no ${what} to click`);
	el.click();
	flushSync();
}

const KINDS: MenuKind[] = [
	{
		name: 'the block menu',
		selector: '.block-menu',
		async open(mounted) {
			surfaceAt(mounted, FENCE).dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
			);
			await mounted.settle();
		}
	},
	{
		name: 'the table menu',
		selector: '.table-action-menu',
		async open(mounted) {
			await pressInCell(mounted, 1, 0, { key: 'F10', shiftKey: true }, TABLE);
		}
	},
	{
		name: 'the code block overflow menu',
		selector: '.code-rail-menu',
		async open(mounted) {
			click(mounted.target.querySelector(`button[aria-label="${CODE_MENU_LABEL}"]`), 'menu button');
			await mounted.settle();
		}
	},
	{
		name: 'the code block language picker',
		selector: '.code-lang-picker',
		async open(mounted) {
			click(mounted.target.querySelector('.code-lang-button'), 'language chip');
			await mounted.settle();
		}
	},
	{
		name: 'the inline menu',
		selector: '[data-inline-menu]',
		async open(mounted) {
			const menus = mounted.instance.getInlineMenus();
			menus.addSource({
				name: 'tags',
				trigger: '#',
				items: () => [{ id: 'a', label: 'a', insert: '#a' }]
			});
			placeCaret(surfaceAt(mounted, [0]), 3);
			menus.open('tags');
			await mounted.settle();
		}
	},
	{
		name: 'the link card',
		selector: '.md-link-card-anchor',
		async open(mounted) {
			await pressKeyAt(mounted, [0], 5, { key: 'k', ctrlKey: true });
		}
	}
];

async function openInLive(kind: MenuKind) {
	const mounted = mountEditor({
		source: DOC,
		presentationMode: 'live',
		codeMenuItems: () => [{ id: 'attach', label: 'Attach', run: () => {} }]
	});
	await mounted.settle();
	const reports: boolean[] = [];
	mounted.instance.getEvents().on('menuChange', (open) => reports.push(open));
	await kind.open(mounted);
	expect(document.querySelector(kind.selector), `${kind.name} opened`).not.toBeNull();
	expect(reports).toEqual([true]);
	return { mounted, reports };
}

describe('a mode change closes every open menu', () => {
	const cases = KINDS.flatMap((kind) =>
		(['reading', 'source'] as PresentationMode[]).map((to) => [kind.name, to, kind] as const)
	);

	it.each(cases)('%s, on a switch from live to %s', async (_name, to, kind) => {
		const { mounted, reports } = await openInLive(kind);

		mounted.props.presentationMode = to;
		await mounted.settle();

		expect(document.querySelector(kind.selector)).toBeNull();
		expect(reports).toEqual([true, false]);
	});
});

describe('a document swap closes every open menu', () => {
	it.each(KINDS.map((kind) => [kind.name, kind] as const))('%s', async (_name, kind) => {
		const { mounted, reports } = await openInLive(kind);

		mounted.props.source = 'other\n';
		await mounted.settle();

		expect(document.querySelector(kind.selector)).toBeNull();
		expect(reports).toEqual([true, false]);
		expect(mounted.source()).toBe('other\n');
	});
});
