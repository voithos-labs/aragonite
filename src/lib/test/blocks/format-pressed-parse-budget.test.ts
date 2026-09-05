// @vitest-environment jsdom
//
// A toolbar asks `isCommandActive` once per button on every `selectionChange`, so the mark ids
// share ONE coverage parse of the focused block, and the next edit misses that read.
// Miss-analysis: the perf gate is ship-only and had not run since 2026-08-20, and no unit pin
// bounded the pressed read's parse count per selection change.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { TOOLBAR_COMMANDS } from '$lib';
import type { AnyCommandId } from '$lib/schema/command-id';
import { listInlineMarks } from '$lib/schema/inline-construct-policy';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import { installLayoutStubs, mountEditor, selectRange, surfaceAt } from './editor-mount';
import { mountCell } from './table/mount-cell';

beforeAll(() => installLayoutStubs());

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
	disablePerfInstruments();
	if (dispose) await dispose();
	dispose = null;
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

/** Off the registry rather than re-listed, so a newly markable kind joins the budget. */
const MARK_COMMANDS = listInlineMarks().map((entry) => entry.mark.command);

/** One toolbar repaint: the same `filter` over every button `SelectionToolbar` runs, with the
 *  parses it spent. Reading the ids back is what keeps a budget of zero from meaning "declined". */
function repaint(ask: (id: AnyCommandId) => boolean): { pressed: AnyCommandId[]; parses: number } {
	const before = perfSnapshot().formatCoverageReads;
	const pressed = MARK_COMMANDS.filter(ask);
	return { pressed, parses: perfSnapshot().formatCoverageReads - before };
}

describe('the pressed read over one prose block', () => {
	function editorOver(source: string) {
		const mounted = mountEditor({ source });
		dispose = mounted.destroy;
		return mounted;
	}

	it('answers every button from one parse, and re-reads once the bytes move', async () => {
		const mounted = editorOver('alpha beta gamma\n');
		selectRange(surfaceAt(mounted, [0]), 0, 5);

		const plain = repaint((id) => mounted.instance.isCommandActive(id));
		expect(plain.pressed).toEqual([]);
		expect(plain.parses).toBe(1);

		expect(mounted.instance.runCommand(TOOLBAR_COMMANDS.toggleStrong)).toBe(true);
		await mounted.settle();
		expect(mounted.source()).toBe('**alpha** beta gamma\n');

		// The SAME offsets, so only the bytes moved: a memo blind to them would answer plain still.
		selectRange(surfaceAt(mounted, [0]), 0, 5);
		const bolded = repaint((id) => mounted.instance.isCommandActive(id));
		expect(bolded.pressed).toEqual([TOOLBAR_COMMANDS.toggleStrong]);
		expect(bolded.parses).toBe(1);
	});

	it('re-reads once the selection moves under unchanged bytes', () => {
		const mounted = editorOver('**alpha** beta\n');
		const surface = surfaceAt(mounted, [0]);

		selectRange(surface, 2, 7);
		expect(repaint((id) => mounted.instance.isCommandActive(id)).pressed).toEqual([
			TOOLBAR_COMMANDS.toggleStrong
		]);

		selectRange(surface, 10, 14);
		const plain = repaint((id) => mounted.instance.isCommandActive(id));
		expect(plain.pressed).toEqual([]);
		expect(plain.parses).toBe(1);
	});
});

describe('the pressed read over one table cell', () => {
	it('answers every button from one parse', () => {
		const mounted = mountCell('**bold** plain');
		dispose = mounted.dispose;
		mounted.el.focus();
		mounted.instance.setSelection(2, 6);

		const painted = repaint((id) => mounted.instance.isCommandActive!(id));
		expect(painted.pressed).toEqual([TOOLBAR_COMMANDS.toggleStrong]);
		expect(painted.parses).toBe(1);
	});
});
