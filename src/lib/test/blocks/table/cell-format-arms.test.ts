// @vitest-environment jsdom
//
// The cell binds every format chord the prose keymap does, so it owes an arm for every one: a
// missing arm returns false and leaves the chord to the browser's own contenteditable bold, an
// edit this surface never authored.
import { describe, it, expect, afterEach } from 'vitest';
import { mountCell } from './mount-cell';

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('format command arms on a table cell', () => {
	it.each([
		['format.toggleStrong', '**ab**'],
		['format.toggleEmphasis', '*ab*'],
		['format.toggleStrikethrough', '~~ab~~'],
		['format.toggleCode', '`ab`']
	])('%s wraps the cell selection', (id, expected) => {
		mounted = mountCell('ab');
		mounted.el.focus();
		mounted.instance.setSelection(0, 2);

		expect(mounted.instance.runCommand(id)).toBe(true);

		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, expected, 0, 0);
	});
});
