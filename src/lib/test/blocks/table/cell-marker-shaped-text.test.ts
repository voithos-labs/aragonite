// @vitest-environment jsdom
//
// A cell whose text starts like a container marker. Cell bytes are never a block, so reading a
// candidate back as one would refuse every such cell and leave the key to the browser, which
// shows the delimiters live-mode.md § 4.4 keeps off screen. The rule itself is covered in
// `blocks/text/construct-edge-delete.test.ts`; this covers the wiring.
//
// Miss-analysis: every case over that rule used prose-shaped fixtures, so nothing separated
// "reads back as what the caller stores" from "reads back as a block".
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
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
	// `- **a** b`, `> **a** b`, `1. **a** b`: each parses as a fragment into a list or a quote,
	// and the caret sits past the strong's hidden closer, where the content byte goes along with
	// the pair the cut empties.
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
