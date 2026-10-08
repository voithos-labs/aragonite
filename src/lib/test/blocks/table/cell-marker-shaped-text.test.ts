// @vitest-environment jsdom
// A cell whose text starts like a container marker: cell bytes are never a block, so reading one
// back as a block leaves the key to the browser, showing delimiters live-mode.md § 4.4 hides.
// The rule is in `blocks/text/construct-edge-delete.test.ts`; this covers the cell wiring.
// Miss-analysis: every case over that rule used prose-shaped fixtures, never marker-shaped text.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt, installTableLayoutStubs } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
	document.body.innerHTML = '';
});

describe('the caret-edge delete still rewrites a cell whose text opens like a marker', () => {
	// Each text parses alone as a list or a quote; the caret sits past the strong's hidden closer,
	// where the content byte goes along with the pair the cut empties.
	it.each([
		['- **a** b', '| -  b | B |\n| --- | --- |\n| 1 | 2 |\n'],
		['> **a** b', '| >  b | B |\n| --- | --- |\n| 1 | 2 |\n'],
		['1. **a** b', '| 1.  b | B |\n| --- | --- |\n| 1 | 2 |\n']
	])('rewrites %j rather than leaving the press to the engine', async (cell, expected) => {
		const source = `| ${cell} | B |\n| --- | --- |\n| 1 | 2 |\n`;
		mounted = mountEditor({ source, presentationMode: 'live' });
		const el = cellAt(mounted, 0, 0);
		placeCaret(el, cell.length - 2);

		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
		);
		await mounted.settle();

		expect(mounted.source()).toBe(expected);
	});
});
