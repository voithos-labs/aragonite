/**
 * G4.67: every menu the editor renders counts itself on `menuChange` by attaching the menu
 * presence count to its own root element. Each menu element either carries the attach in its
 * opening tag or is listed below with the reason it does not, so a second menu added to a file
 * that already counts one cannot open without the host hearing it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, walkCode } from './scan-source';

/** A menu's root element: the shared menu class (its rows are `md-menu-item`) or a popup role. */
const MENU_ELEMENT_RE = /class="md-menu["\s]|role="(?:menu|listbox|dialog)"/;
const TRACK_RE = /\{@attach\s+menuPresence\.track\s*\}/;

/** Menu elements that do not count themselves, by file: a text only that element's tag holds. */
const NOT_COUNTED: Record<string, { tag: string; reason: string }[]> = {
	'src/lib/components/blocks/code/CodeBlockRail.svelte': [
		{ tag: 'code-lang-list', reason: 'the list inside the language picker, which counts itself' }
	],
	'src/lib/components/menu/SelectionToolbar.svelte': [
		{
			tag: 'md-menu selection-toolbar"',
			reason: 'the toolbar hides itself on menuChange, so counting it would hide it at once'
		},
		{
			tag: 'selection-toolbar-flyout',
			reason: 'counting the toolbar flyout would hide the toolbar under the pointer'
		}
	],
	'src/lib/components/link-card/LinkCard.svelte': [
		{ tag: 'md-link-card"', reason: 'LinkCardHost.svelte counts the anchor this card renders in' }
	],
	'src/lib/plugins/mermaid/MermaidBlock.svelte': [
		{
			tag: 'mermaid-overlay"',
			reason: 'a full-window focus view the plugin owns; plugins have no menu count to reach'
		}
	]
};

/** Blanks `<script>` and `<style>` bodies so a `<` comparison there never reads as a tag. */
function markupOnly(code: string): string {
	return code.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (block) => block.replace(/\S/g, ' '));
}

/** Every opening tag in the markup, read up to the `>` that sits outside quotes and braces. */
function openingTags(code: string): string[] {
	const markup = markupOnly(code);
	const tags: string[] = [];
	for (const start of markup.matchAll(/<[a-zA-Z]/g)) {
		let depth = 0;
		const end = walkCode(markup, start.index + 1, (ch) => {
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			else if (ch === '>' && depth === 0) return true;
		});
		tags.push(markup.slice(start.index, end + 1));
	}
	return tags;
}

/** The opening tags in a file that render a menu and do not attach the count. */
function uncountedMenus(code: string): string[] {
	return openingTags(code).filter((tag) => MENU_ELEMENT_RE.test(tag) && !TRACK_RE.test(tag));
}

/** Uncounted menus no listed entry excuses, as `file: tag` lines. */
function unexcused(relPath: string, code: string): string[] {
	const excuses = NOT_COUNTED[relPath] ?? [];
	return uncountedMenus(code)
		.filter((tag) => !excuses.some((excuse) => tag.includes(excuse.tag)))
		.map((tag) => `${relPath}: ${tag.replace(/\s+/g, ' ')}`);
}

describe('G4.67 every editor menu counts itself on menuChange', () => {
	const sources = collectEditorSources().filter(
		(file) =>
			file.relPath.endsWith('.svelte') &&
			(file.relPath.startsWith('src/lib/components/') ||
				file.relPath.startsWith('src/lib/plugins/'))
	);

	it('inspected the menu components', () => {
		expect(sources.some((file) => file.relPath.endsWith('BlockMenu.svelte'))).toBe(true);
	});

	it('every menu element attaches the count or is listed with a reason', () => {
		const silent = sources.flatMap((file) => unexcused(file.relPath, file.code));
		expect(silent, 'a menu that never reports on menuChange').toEqual([]);
	});

	it('every listed element is still one uncounted menu in its file (no stale entry)', () => {
		for (const [relPath, excuses] of Object.entries(NOT_COUNTED)) {
			const file = sources.find((source) => source.relPath === relPath);
			expect(file, `listed file is gone: ${relPath}`).toBeDefined();
			const uncounted = uncountedMenus(file!.code);
			for (const excuse of excuses) {
				const matches = uncounted.filter((tag) => tag.includes(excuse.tag));
				expect(matches.length, `stale entry in ${relPath}: ${excuse.tag}`).toBe(1);
			}
		}
	});

	it('the link card host counts the card it renders', () => {
		const host = sources.find((file) => file.relPath.endsWith('link-card/LinkCardHost.svelte'));
		expect(TRACK_RE.test(host!.code)).toBe(true);
	});

	it('the matcher tells a menu root from a menu row and from script code', () => {
		expect(uncountedMenus('<div class="md-menu block-menu" role="menu">')).toHaveLength(1);
		expect(uncountedMenus('<div role="listbox">')).toHaveLength(1);
		expect(uncountedMenus('<div role="dialog">')).toHaveLength(1);
		expect(uncountedMenus('<button class="md-menu-item">')).toEqual([]);
		expect(uncountedMenus("<script>target.closest('.md-menu')</script>")).toEqual([]);
		expect(uncountedMenus('<ul class="md-menu" {@attach menuPresence.track}>')).toEqual([]);
	});

	it('the matcher reads a tag across lines and past a `>` inside braces', () => {
		const tag =
			'<div\n\tclass="md-menu x"\n\tonclick={() => a > b}\n\t{@attach menuPresence.track}\n>';
		expect(uncountedMenus(tag)).toEqual([]);
	});

	it('a second, uncounted menu in a file that counts one is still reported', () => {
		const file = [
			'<div class="md-menu first" role="menu" {@attach menuPresence.track}></div>',
			'<div class="md-menu second" role="menu"></div>'
		].join('\n');
		expect(unexcused('src/lib/components/Fixture.svelte', file)).toEqual([
			'src/lib/components/Fixture.svelte: <div class="md-menu second" role="menu">'
		]);
	});
});
