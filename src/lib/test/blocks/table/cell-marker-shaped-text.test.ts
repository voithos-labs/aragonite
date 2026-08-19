// @vitest-environment jsdom
//
// A cell whose text OPENS like a container marker. Cell bytes are never a block, so a seam reading
// its candidate back as one refuses every such cell, and the caret-edge arm leaves the press to the
// engine, which paints the delimiters live-mode.md § 4.4 keeps off screen. The arm's own contract is
// pinned in `blocks/text/construct-edge-delete.test.ts`; this pins the WIRING.
//
// Miss-analysis: every case over that arm fed it prose-shaped fixtures, so nothing separated
// "reads back as what the caller installs" from "reads back as a block".
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, placeCaret, type MountedEditor } from '../editor-mount';
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
	// `- **a** b`, `> **a** b`, `1. **a** b`: each fragment-parses to a list or a quote, and the
	// caret sits past the strong's hidden closer, where the arm takes the content byte and the
	// pair the cut empties.
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
