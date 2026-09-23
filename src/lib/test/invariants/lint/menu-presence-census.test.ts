/**
 * G4.67: every menu the editor renders counts itself on `menuChange` by attaching the menu
 * presence count to its root element. A file that renders a menu either attaches it or is listed
 * below with the reason it does not, so the next menu cannot open without the host hearing it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** A menu's root element: the shared menu class (its rows are `md-menu-item`) or a popup role. */
const MENU_ELEMENT_RE = /class="md-menu["\s]|role="(?:menu|listbox|dialog)"/;
const TRACK_RE = /\{@attach\s+menuPresence\.track\s*\}/;

/** Files that render a menu without counting it, and why. */
const NOT_COUNTED: Record<string, string> = {
	'src/lib/components/menu/SelectionToolbar.svelte':
		'the toolbar hides itself on menuChange, so counting its own flyout would hide it under the pointer',
	'src/lib/components/link-card/LinkCard.svelte':
		'LinkCardHost.svelte counts the anchor element this card renders inside',
	'src/lib/plugins/mermaid/MermaidBlock.svelte':
		'a full-window focus view the plugin owns; the plugin surface has no menu count to reach'
};

const isMenuFile = (code: string) => MENU_ELEMENT_RE.test(code);

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

	it('every file rendering a menu attaches the count or is listed with a reason', () => {
		const silent = sources
			.filter((file) => isMenuFile(file.code) && !TRACK_RE.test(file.code))
			.map((file) => file.relPath)
			.filter((relPath) => !(relPath in NOT_COUNTED));
		expect(silent, 'a menu that never reports on menuChange').toEqual([]);
	});

	it('every listed file still renders a menu and still does not count it (no stale entry)', () => {
		for (const relPath of Object.keys(NOT_COUNTED)) {
			const file = sources.find((source) => source.relPath === relPath);
			expect(file, `listed file is gone: ${relPath}`).toBeDefined();
			expect(isMenuFile(file!.code), `stale entry, no menu: ${relPath}`).toBe(true);
			expect(TRACK_RE.test(file!.code), `stale entry, counts itself: ${relPath}`).toBe(false);
		}
	});

	it('the link card host counts the card it renders', () => {
		const host = sources.find((file) => file.relPath.endsWith('link-card/LinkCardHost.svelte'));
		expect(TRACK_RE.test(host!.code)).toBe(true);
	});

	it('the matcher tells a menu root from a menu row and a comment', () => {
		expect(isMenuFile('<div class="md-menu block-menu" role="menu">')).toBe(true);
		expect(isMenuFile('<div role="listbox">')).toBe(true);
		expect(isMenuFile('<div role="dialog">')).toBe(true);
		expect(isMenuFile('<button class="md-menu-item">')).toBe(false);
		expect(isMenuFile("target.closest('.md-menu')")).toBe(false);
		expect(TRACK_RE.test('<ul class="md-menu" {@attach menuPresence.track}>')).toBe(true);
	});
});
