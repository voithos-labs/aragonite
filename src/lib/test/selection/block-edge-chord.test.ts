// @vitest-environment jsdom
// Mod+Home and Mod+End land on the text's edge where a marker or a widget sits at that end, in a
// prose block and a table cell alike, and are the browser's everywhere else.
// Miss-analysis: Mod+Home was decided only in a prose block, and no row pressed Mod+End beside a
// widget, which Firefox's own stops short of.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { cellAt, installTableLayoutStubs } from '../blocks/table/mount-table';
import { rawSelectionFocus } from '#lib/browser/selection-read.js';

let restoreTableLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreTableLayout = installTableLayoutStubs();
	return () => restoreTableLayout();
});
afterEach(destroyMountedEditors);

type Surface = 'prose' | 'cell';

function mountText(surface: Surface, text: string): HTMLElement {
	const source = surface === 'prose' ? `${text}\n` : `| H |\n| :- |\n| ${text} |\n`;
	const editor = mountEditor({ source });
	return surface === 'prose' ? surfaceAt(editor, [0]) : cellAt(editor, 1, 0);
}

describe.each(['prose', 'cell'] as const)('%s', (surface) => {
	it.each([
		['Mod+End before a closing widget', 'Left<br>', 0, 'End', 8],
		['Mod+Home after an opening widget', '<br>Left', 8, 'Home', 0]
	])('%s lands on the text’s edge', async (_, text, from, key, to) => {
		const el = mountText(surface, text);
		placeCaret(el, from);

		const event = await pressKey(el, { key, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(rawSelectionFocus(el)).toBe(to);
	});

	it('Mod+End with text at the end is the browser’s', async () => {
		const el = mountText(surface, 'Left');
		placeCaret(el, 0);

		const event = await pressKey(el, { key: 'End', ctrlKey: true });

		expect(event.defaultPrevented).toBe(false);
	});
});
