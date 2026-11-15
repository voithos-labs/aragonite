// @vitest-environment jsdom
// Where a gesture over a range lands, over drawn ranges that start on a block taken whole (a rule, a
// heading, a fence, a table, a callout) and end at a paragraph's end, a heading's end, a leaf's
// middle or inside a callout they enter; under a blank line, a block right above or nothing; at the
// top level, in a quote, an item or a callout; mounted in both modes, each gesture then a letter
// (`docs/design/structural-edits.md` § Structural operations, `selection.md` § Cross-block selection).
// Each property names the gestures it binds.
// Miss-analysis: the rows that started on a block taken whole and ended at a paragraph's end were
// the closers lane's named rows, pinned on the bytes the removal gave, and no law set them beside the
// same range from a paragraph's text start, so a line the range emptied went unseen.
// Deep and fresh: `node scripts/run-with-env.mjs PROPERTY_FRESH=1 LANDING_DRAWS=200 -- vitest run`
// and this file's path.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { cellPoint, type EditorSelection, type SelectionPoint } from '#lib/selection/primitives.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { clipboardGesture, mountCase, pasteGesture, placeRange, type Editor } from './gestures';

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

// ── The drawn ranges ─────────────────────────────────────────────────────────

/** The block the range starts on, taken whole; `⟦` marks its first byte. */
const STARTS: Record<string, string[]> = {
	rule: ['⟦***'],
	heading: ['⟦# head'],
	fence: ['⟦```', 'code', '```'],
	table: ['⟦| a | b |', '|---|---|', '| 1 | 2 |'],
	callout: ['⟦:::tip', 'body', ':::']
};
/** The same range from a paragraph's text start: what a range from a block taken whole is set beside. */
const TWIN_START = ['⟦zero'];

const ABOVES: Record<string, string[]> = {
	'under a blank line': ['first', ''],
	'right under a paragraph': ['first'],
	'right under a heading': ['# top'],
	'right under a rule': ['___'],
	'first in its container': []
};

/** Where the range ends, after a blank line; `⟧` marks it. */
const ENDS: Record<string, string[]> = {
	'a paragraph’s end': ['para⟧'],
	'a heading’s end': ['# end⟧'],
	'a leaf’s middle': ['pa⟧ra'],
	'inside a callout it enters': [':::tip', 'in⟧ner', ':::']
};

const AFTERS: Record<string, string[]> = {
	'a paragraph': ['next'],
	'a heading': ['# next'],
	'a fence': ['```', 'c', '```'],
	'a callout': [':::note', 'more', ':::'],
	nothing: []
};

const WRAPS: Record<string, (lines: string[]) => string[]> = {
	'the top level': (lines) => lines,
	'a quote': (lines) => lines.map((l) => (l ? `> ${l}` : '>')),
	'an item': (lines) => lines.map((l, i) => (i === 0 ? `- ${l}` : l ? `  ${l}` : '')),
	'a callout': (lines) => ['::::note', ...lines, '::::']
};

interface Draw {
	start: string;
	above: string;
	end: string;
	after: string;
	wrap: string;
	/** Whether what follows stands inside the container, so the range doesn't run to its end. */
	inside: boolean;
	mode: PresentationMode;
}

const arbDraw: fc.Arbitrary<Draw> = fc
	.record({
		start: fc.constantFrom(...Object.keys(STARTS)),
		above: fc.constantFrom(...Object.keys(ABOVES)),
		end: fc.constantFrom(...Object.keys(ENDS)),
		after: fc.constantFrom(...Object.keys(AFTERS)),
		wrap: fc.constantFrom(...Object.keys(WRAPS)),
		inside: fc.boolean(),
		mode: fc.constantFrom<PresentationMode>('source', 'live')
	})
	// A table or a callout's opening line doesn't break into the paragraph right above it.
	.filter(
		(d) => !(d.above === 'right under a paragraph' && ['table', 'callout'].includes(d.start))
	);

function marked(d: Draw, start: string[]): string {
	const after = AFTERS[d.after];
	const body = [...ABOVES[d.above], ...start, '', ...ENDS[d.end]];
	const within = d.inside && after.length ? [...body, '', ...after] : body;
	const outside = !d.inside && after.length ? ['', ...after] : [];
	return [...WRAPS[d.wrap](within), ...outside].join('\n') + '\n';
}

/** Ruling 2's exception: the line the range empties goes where it runs to its container's end
 *  from right under a block or the callout's opening row, or ends a callout's body under a blank line. */
function lineGoes(d: Draw): boolean {
	const toEnd = !d.inside || d.after === 'nothing';
	if (d.wrap === 'the top level' || !toEnd) return false;
	if (d.wrap === 'a callout') return true;
	return d.above !== 'under a blank line' && d.above !== 'first in its container';
}

/** A paragraph emptied where the same range from a paragraph's text start would empty one too. */
const hasTwin = (d: Draw) =>
	d.end === 'a paragraph’s end' && d.above !== 'right under a paragraph' && !lineGoes(d);

/** Booked, not ruled: a range from a fence or a callout's opening row asks that block's keymap for
 *  Mod+digit, which binds none, so the key goes to the browser and the range stays. */
const unclaimed = (d: Draw, g: Gesture) => ['fence', 'callout'].includes(d.start) && g === 'Mod+2';

/** Lane 5a's count: a command key over a range that runs in a block of another kind than claimed it. */
const LANE_5A = 'invariant:command-key-landing';

/** Ruling 9 leaves a line break on the block before the range where no emptied line is kept; on a
 *  rule that break warns (G1.223) until ruling 6 moves landings off syntax. */
const breaksOnRule = (d: Draw, g: Gesture) =>
	(g === 'Enter' || g === 'Shift+Enter') &&
	d.above === 'right under a rule' &&
	(d.end !== 'a paragraph’s end' || lineGoes(d));

// ── One gesture, then a letter ───────────────────────────────────────────────

const GESTURES = [
	'Backspace',
	'Delete',
	'a cut',
	'a typed key',
	'a composition',
	'Enter',
	'Shift+Enter',
	'Mod+2',
	'a one-line paste'
] as const;
type Gesture = (typeof GESTURES)[number];

/** What a written gesture types: no drawn document holds it. */
const WRITTEN = 'ж';

/** The gestures P2 and P3 bind; a paste waits for its own landing, Shift+Enter and Mod+digit for
 *  ruling 9. */
const WRITES = ['a typed key', 'a composition'] as const;

/** The text left of the leaf the range ended in, which written text may stand before. */
const RESTS: Record<string, string> = {
	'a leaf’s middle': 'ra',
	'inside a callout it enters': 'ner'
};

/** Ruling 8, a later slice: behind a kept opening a typed key writes above the callout, where a
 *  composition writes before the rest. */
const restBehindOpening = (d: Draw) => d.end === 'inside a callout it enters';

/** Booked, not ruled: the end leaf's rest takes the place of a block taken whole right under a
 *  paragraph and runs on into it, as two paragraphs a removal leaves flush rejoin. */
const restRunsOn = (d: Draw) =>
	d.end === 'a leaf’s middle' && d.above === 'right under a paragraph';

type Block = { raw: string; children?: readonly Block[] };

/** The text of the leaf holding what a gesture wrote. */
function writtenLeaf(blocks: readonly Block[]): string | undefined {
	for (const block of blocks) {
		const found = block.children?.length
			? writtenLeaf(block.children)
			: block.raw.includes(WRITTEN)
				? block.raw.trimEnd()
				: undefined;
		if (found !== undefined) return found;
	}
	return undefined;
}

interface Landing {
	bytes: string;
	/** The caret after the gesture: a byte, or the gap it holds. */
	caret: string;
	/** The document once `x` is typed after the gesture. */
	lettered: string;
	warns: string[];
}

/** The selection between the marks of `text`, read on the document `editor` opened. */
function rangeOf(editor: Editor, text: string): EditorSelection {
	const from = text.indexOf('⟦');
	const to = text.indexOf('⟧') - 1;
	const layout = documentLayout(measured(editor.instance.__test.getDocument()));
	const table = [...layout.within(from, from)].find((b) => b.type === 'table' && b.from === from);
	const at = (byte: number): SelectionPoint => {
		const point = layout.pointAt(byte);
		if (point) return { path: point.path, offset: point.offset };
		const block = [...layout.within(byte, byte)].find((b) => b.from === byte && !b.container);
		if (!block) throw new Error(`no point at ${byte} in ${JSON.stringify(text)}`);
		return { path: block.path, offset: 0 };
	};
	return { anchor: table ? cellPoint(table.path, 0) : at(from), focus: at(to) };
}

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function press(editor: Editor, init: KeyboardEventInit): Promise<void> {
	await pressHardwareKey(focused(), init);
	await editor.settle();
}

async function run(editor: Editor, gesture: Gesture): Promise<void> {
	if (gesture === 'a cut') await clipboardGesture(editor, 'cut', 'key');
	else if (gesture === 'a one-line paste')
		await pasteGesture(editor, { 'text/plain': WRITTEN }, 'key');
	else if (gesture === 'a typed key') await insertBy('hardware key', focused(), WRITTEN);
	else if (gesture === 'a composition') await insertBy('composition', focused(), WRITTEN);
	else if (gesture === 'Shift+Enter') await press(editor, { key: 'Enter', shiftKey: true });
	else if (gesture === 'Mod+2') await press(editor, { key: '2', ctrlKey: true });
	else await press(editor, { key: gesture });
	await editor.settle();
}

/** The byte the editor's caret names, or the gap it holds. */
function caretOf(editor: Editor): string {
	const gap = editor.instance.__test.getGapCaret();
	if (gap) return `gap ${gap.parentPath.join('.')}#${gap.index}`;
	const focus = editor.instance.getSelection()?.focus;
	if (!focus) return 'none';
	const layout = documentLayout(measured(editor.instance.__test.getDocument()));
	return String(
		layout.byteOf(focus.path, focus.offset) ?? `${focus.path.join('.')}:${focus.offset}`
	);
}

async function mounted(text: string, mode: PresentationMode) {
	const source = text.replace('⟦', '').replace('⟧', '');
	await destroyMountedEditors();
	takeDevWarns();
	const editor = mountCase(source, mode);
	await editor.settle();
	const select = rangeOf(editor, text);
	expect(await placeRange(editor, select), `placed over ${JSON.stringify(text)}`).toBe(true);
	return { editor, source, select };
}

async function land(text: string, mode: PresentationMode, gesture: Gesture): Promise<Landing> {
	const { editor } = await mounted(text, mode);
	await run(editor, gesture);
	const bytes = editor.source();
	const caret = caretOf(editor);
	await press(editor, { key: 'x' });
	const warns = takeDevWarns().map((w) => w.tag);
	return { bytes, caret, lettered: editor.source(), warns };
}

const DRAWS = Number(process.env.LANDING_DRAWS ?? 16);
const SEED = freshOrFixedSeed(20261115);
const params = (scale = 1) => ({ numRuns: Math.max(1, Math.round(DRAWS * scale)), seed: SEED });

// ── The laws ─────────────────────────────────────────────────────────────────

describe('the landing law', () => {
	it('P1: Backspace, Delete and a cut leave the same bytes', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw, async (d) => {
				const text = marked(d, STARTS[d.start]);
				const back = await land(text, d.mode, 'Backspace');
				for (const g of ['Delete', 'a cut'] as const)
					expect((await land(text, d.mode, g)).bytes, `${g} over ${JSON.stringify(text)}`).toBe(
						back.bytes
					);
			}),
			params(1.5)
		);
	}, 600_000);

	it('P2: text a typed key or a composition writes stands alone or before the end leaf’s rest', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbDraw.filter((d) => !restRunsOn(d)),
				fc.constantFrom(...WRITES),
				async (d, g) => {
					const text = marked(d, STARTS[d.start]);
					const { editor } = await mounted(text, d.mode);
					await run(editor, g);
					takeDevWarns();
					const rest = RESTS[d.end] ?? '';
					const leaf = writtenLeaf(editor.instance.__test.getDocument().children);
					expect([WRITTEN, WRITTEN + rest], `${g} over ${JSON.stringify(text)}`).toContain(leaf);
				}
			),
			params(1.5)
		);
	}, 600_000);

	it('P3: a typed key and a composition leave the same bytes', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbDraw.filter((d) => !restBehindOpening(d)),
				async (d) => {
					const text = marked(d, STARTS[d.start]);
					const typed = await land(text, d.mode, 'a typed key');
					const composed = await land(text, d.mode, 'a composition');
					expect(composed.bytes, JSON.stringify(text)).toBe(typed.bytes);
				}
			),
			params()
		);
	}, 600_000);

	it('P1b: outside its exception, a range from a block taken whole lands as its twin does, every gesture', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw.filter(hasTwin), fc.constantFrom(...GESTURES), async (d, g) => {
				if (unclaimed(d, g)) return;
				const text = marked(d, STARTS[d.start]);
				const twin = marked(d, TWIN_START);
				const got = await land(text, d.mode, g);
				const want = await land(twin, d.mode, g);
				expect({ ...got, warns: [] }, `${g} over ${JSON.stringify(text)}`).toEqual({
					...want,
					warns: []
				});
			}),
			params(3)
		);
	}, 600_000);

	it('P6: where text stands at the seam, the three removal keys leave one caret', async () => {
		const seam = (d: Draw) =>
			d.end === 'a leaf’s middle' || (d.end === 'a paragraph’s end' && !lineGoes(d));
		await fc.assert(
			fc.asyncProperty(arbDraw.filter(seam), async (d) => {
				const text = marked(d, STARTS[d.start]);
				const carets: string[] = [];
				for (const g of ['Backspace', 'Delete', 'a cut'] as const)
					carets.push((await land(text, d.mode, g)).caret);
				expect(new Set(carets).size, `${carets.join(', ')} over ${JSON.stringify(text)}`).toBe(1);
			}),
			params()
		);
	}, 600_000);

	it('P8: undo returns the range, every gesture', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw, fc.constantFrom(...GESTURES), async (d, g) => {
				const text = marked(d, STARTS[d.start]);
				const { editor, source, select } = await mounted(text, d.mode);
				await run(editor, g);
				for (let n = 0; n < 3 && editor.source() !== source; n++)
					await press(editor, { key: 'z', ctrlKey: true });
				takeDevWarns();
				expect(editor.source(), `${g} over ${JSON.stringify(text)}`).toBe(source);
				expect(editor.instance.getSelection()).toEqual(select);
			}),
			params(1.5)
		);
	}, 600_000);

	it('P9: no gesture warns in development', async () => {
		await fc.assert(
			fc.asyncProperty(arbDraw, fc.constantFrom(...GESTURES), async (d, g) => {
				const text = marked(d, STARTS[d.start]);
				const { warns } = await land(text, d.mode, g);
				const ruled = (tag: string) =>
					tag === LANE_5A || (tag === 'invariant:range-break-landing' && breaksOnRule(d, g));
				const own = warns.filter((tag) => !ruled(tag));
				expect(own, `${g} over ${JSON.stringify(text)}`).toEqual([]);
			}),
			params(1.5)
		);
	}, 600_000);
});

// ── The row with no twin ─────────────────────────────────────────────────────

// A paragraph right above the range with no blank line has no twin: the same range from a paragraph
// would read as that paragraph's next line. The emptied line still stays, under a blank line.
describe('a range from a block taken whole right under a paragraph', () => {
	for (const mode of ['source', 'live'] as const)
		for (const g of GESTURES)
			it(`${mode}: ${g} leaves the emptied line and lands on it`, async () => {
				const got = await land('above\n⟦***\n\npara⟧\n\nnext\n', mode, g);
				const written = g === 'a typed key' || g === 'a composition' || g === 'a one-line paste';
				const line = written ? WRITTEN : g === 'Mod+2' ? '## ' : '';
				const lines = g === 'Enter' ? '\n\n' : line ? `${line}\n\n` : '\n';
				expect(got.bytes).toBe(`above\n\n${lines}next\n`);
				const typed = g === 'Shift+Enter' ? '\\\nx' : g === 'Enter' ? '\nx' : `${line}x`;
				expect(got.lettered).toBe(`above\n\n${typed}\n\nnext\n`);
			});
});

// ── Text over a range that leaves no text of its own ─────────────────────────

// Miss-analysis: the rows of text over a range that took its start block ended inside a leaf's
// text or held a gap, so none ended at a block's end before prose, where the text joined it.
describe('text written over a range that leaves no text of its own stands in its own paragraph', () => {
	const ROWS: [string, string, string][] = [
		['after a block it took whole', 'first\n\n⟦***\n\n# head⟧\n\nlast\n', 'first\n\nж\n\nlast\n'],
		['right under a heading', '# top\n⟦***\n\n# head⟧\n\nlast\n', '# top\n\nж\n\nlast\n'],
		[
			'ending a callout’s body',
			':::note\nabove\n\n⟦***\n\n# head⟧\n:::\n',
			':::note\nabove\n\nж\n:::\n'
		],
		// The control: text the range left of its own takes the write where it is.
		['before the end leaf’s rest', 'first\n\n⟦***\n\npa⟧ra\n\nnext\n', 'first\n\nжra\n\nnext\n']
	];
	for (const mode of ['source', 'live'] as const)
		for (const [name, text, written] of ROWS)
			for (const g of WRITES)
				it(`${mode}: ${g}, ${name}`, async () => {
					expect((await land(text, mode, g)).bytes).toBe(written);
				});
});
