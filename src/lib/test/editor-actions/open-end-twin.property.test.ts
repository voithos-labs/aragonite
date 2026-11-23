// @vitest-environment jsdom
// A gesture at the end of a file with no final line break does what it does in the same file with
// one, then the break comes off unless the line left last is blank
// (`docs/design/syntax-tree.md` § The last line): the bytes, the caret and the letter typed next.
// A draw that departs fails unless a known class holds it, each pinned by a repro that must still
// depart, so the fix that closes a class deletes its row. `OPEN_END_RUNS` runs it deeper.
// Miss-analysis: the open-end property drew structural edits alone, and every content row compared
// an open file with bytes written by hand, so no run asked the file's own twin what a key leaves.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/property-seed.js';
import {
	arbDraw,
	keptLines,
	KNOWN,
	over,
	stepsOver,
	twinLines,
	type Draw,
	type Step
} from './open-end-twin';

const RUNS = Number(process.env.OPEN_END_RUNS ?? 40);
const SEED = freshOrFixedSeed(20261122);

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

// ── The runs, judged once ────────────────────────────────────────────────────

interface Judged {
	twin: string[];
	kept: string[];
}

// Both properties judge the same runs, so the second reads the first's from here.
const runs = new Map<string, Promise<Judged | null>>();
function judged(draw: Draw): Promise<Judged | null> {
	const key = JSON.stringify(draw);
	if (!runs.has(key)) runs.set(key, judge(draw));
	return runs.get(key)!;
}

async function judge(draw: Draw): Promise<Judged | null> {
	const ending = draw.source.includes('\r\n') ? '\r\n' : '\n';
	const twin: Step[] | null = await stepsOver(draw.source + ending, draw);
	const open = twin && (await stepsOver(draw.source, draw));
	return open && { twin: twinLines(draw, open, twin), kept: keptLines(draw, open) };
}

// ── The properties ───────────────────────────────────────────────────────────

const unknown = (draw: Draw, lines: string[]) =>
	lines.length > 0 && !KNOWN.some((known) => known.holds(draw)) ? lines : [];

const AT_END = { back: 0, at: 'end', inside: 0 } as const;

/** The shapes the open end lost a line break on, each a fixed draw the seed's few may miss. */
const EXAMPLES: Draw[] = (['source', 'live'] as const).flatMap((mode) => [
	over('above\npq', 'browser', { key: 'Backspace' }, mode),
	over('above\npq', 'editor', { key: 'Delete' }, mode),
	over('above\npq', 'editor', { cut: 'then pasted back' }, mode),
	over('- one\n- two\n  pq', 'browser', { key: 'Delete' }, mode),
	over('- one\n- two\n  pq', 'editor', { cut: 'key' }, mode),
	over('> above\n> pq', 'browser', { soft: 'Backspace' }, mode),
	over('zz\n\n```\npq', 'browser', { cut: 'key' }, mode),
	over('zz\n\n~~~\npq\n~~~', 'editor', { key: 'Delete' }, mode),
	over('zz\n\n# head', 'editor', { key: 'Backspace' }, mode),
	over('above\npq', 'browser', { letter: ' ', route: 'hardware key' }, mode),
	over('zz\n\n$$\nx\npq', 'browser', { letter: ' ', route: 'soft key' }, mode),
	// A code block's whole text, which takes the block from under the line it touches.
	{
		source: 'a\n```\nx\n```',
		mode,
		where: { from: AT_END, to: AT_END, holder: 'editor' },
		gesture: { key: 'Delete' }
	}
]);

const PARAMS = {
	numRuns: RUNS + EXAMPLES.length,
	seed: SEED,
	examples: EXAMPLES.map((draw) => [draw] as [Draw])
};

describe('a gesture at an open end, then a letter', () => {
	it('leaves what its twin with a final line break leaves, less that break', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw, async (draw) => {
				const run = await judged(draw);
				fc.pre(run !== null);
				expect(unknown(draw, run!.twin)).toEqual([]);
			}),
			PARAMS
		);
	}, 240_000);

	it('keeps the file open, or ends it on a blank line', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw, async (draw) => {
				const run = await judged(draw);
				fc.pre(run !== null);
				expect(unknown(draw, run!.kept)).toEqual([]);
			}),
			PARAMS
		);
	}, 240_000);

	it('no known class holds a fixed draw, which would pass it unjudged', () => {
		expect(EXAMPLES.filter((draw) => KNOWN.some((known) => known.holds(draw)))).toEqual([]);
	});

	it.each(KNOWN)(
		'still departs: $defect',
		async ({ repro, holds }) => {
			const run = await judged(repro);
			expect(holds(repro)).toBe(true);
			expect([...run!.twin, ...run!.kept]).not.toEqual([]);
		},
		30_000
	);
});
