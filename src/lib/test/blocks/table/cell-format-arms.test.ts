// @vitest-environment jsdom
//
// The cell binds every format chord the prose keymap does, so it owes an arm for every one: a
// missing arm returns false and leaves the chord to the browser's own contenteditable bold, an
// edit this surface never authored.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { planCrossBlockFormat } from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
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

// The cross-block plan reads a cell's bytes off the TREE where this surface reads them off its
// own DOM; a cell is zero-ambient, so the two readings are the same bytes, and nothing but this
// pairing holds them together. Bytes only — the range arm also votes a direction of its own.
describe('the cross-block plan reads the cell bytes the surface arm reads', () => {
	const wholeCell = (index: number): SelectionPoint => ({
		path: [0],
		offset: index,
		cellCoordinate: true
	});

	it.each(['ab', 'a b', 'a\\|b', 'a *b* c'])('agree on %s', (raw) => {
		mounted = mountCell(raw);
		mounted.el.focus();
		mounted.instance.setSelection(0, raw.length);
		mounted.instance.runCommand('format.toggleStrong');
		const surfaceBytes = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls[0][1];

		const doc = parse(`| ${raw} | b |\n| --- | --- |\n| c | d |\n`);
		const plan = planCrossBlockFormat(doc, wholeCell(0), wholeCell(0), 'strong', undefined)!;
		expect(plan.writes[0].newDisplay).toBe(surfaceBytes);
	});
});
