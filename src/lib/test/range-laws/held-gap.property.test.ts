// @vitest-environment jsdom
// The held-gap law (`held-gap.test.ts`) over drawn documents whose removal makes the parser read a
// neighbour again: a block's line between two table halves, two indented code blocks or two HTML
// blocks, above a setext underline or a lazy line, under a title a definition started; at top
// level, in a quote, in an item; the range from that block's edge, mid-line or a table row.
// Enter over the range leaves what Backspace then Enter leave. Text over it (a letter, a paste, a
// composition) leaves what the removal then the text leave where that removal's caret is a gap,
// prose, or no block boundary stands where the range started; anywhere else the text stands in a
// paragraph of its own there, the rest as the removal left it (`docs/design/selection.md`).
// Every violation must match a class declared below, and the fixed run pins the counts.
// Miss-analysis: the law's rows were named shapes whose commit never moved the blocks above the
// range, so a place read before the commit always still named the right block.
// Deep and fresh: `node scripts/run-with-env.mjs PROPERTY_FRESH=1 HELD_GAP_DRAWS=2000 -- vitest run`
// and this file's path.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { appendFileSync } from 'node:fs';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { Measured } from '#lib/tree-operations/top-level-starts.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { cellPoint } from '#lib/selection/primitives.js';
import { pointAtByte, readsAsText, removalBytes } from '#lib/selection/range-bytes.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import type { Removed } from '#lib/selection/cross-block/range-removal.js';
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
import {
	blocksIn,
	blocksOf,
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	type Editor
} from './gestures';
import { MIDDLES, NEIGHBOURS } from './shapes';

/** Each `emptiedPlace` call in a draw: whether its removal took the block the range started in. */
const seen: { took: boolean }[] = [];
vi.mock('#lib/selection/cross-block/range-removal.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('#lib/selection/cross-block/range-removal.js')>();
	return {
		...actual,
		emptiedPlace: vi.fn((m: Measured, removed: Removed) => {
			seen.push({ took: removed.taken !== null });
			return actual.emptiedPlace(m, removed);
		})
	};
});

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(destroyMountedEditors);

// ── The drawn documents ──────────────────────────────────────────────────────

const WRAPS = ['top', 'quote', 'item'] as const;
/** Where the range starts (the taken block's edge, mid-line above it, a table row's cell) and ends. */
const RANGES = [
	'edge..lower',
	'edge..lower mid',
	'edge..wrap end',
	'edge..last',
	'upper mid..lower',
	'cell..middle',
	'cell..lower'
] as const;
const GESTURES = ['letter', 'paste', 'composition', 'Enter'] as const;
/** What each text gesture types: no drawn document holds either. */
const TEXT = { letter: 'ж', paste: 'ж', composition: '汉' } as const;

interface Draw {
	shape: string;
	middle: string;
	/** A quote in an item too, for the depth row only. */
	wrap: (typeof WRAPS)[number] | 'quote in item';
	range: (typeof RANGES)[number];
	gesture: (typeof GESTURES)[number];
	mode: PresentationMode;
	eol: '\n' | '\r\n';
	lead: 0 | 1 | 2;
	word: string;
	/** The block below the wrap; `last`, a paragraph, where absent. */
	tail?: 'fence';
}

const arbDraw: fc.Arbitrary<Draw> = fc
	.record({
		shape: fc.constantFrom(...Object.keys(NEIGHBOURS)),
		middle: fc.constantFrom(...Object.keys(MIDDLES)),
		wrap: fc.constantFrom(...WRAPS),
		range: fc.constantFrom(...RANGES),
		gesture: fc.constantFrom(...GESTURES),
		mode: fc.constantFrom<PresentationMode>('source', 'live'),
		eol: fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n'),
		lead: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
		word: fc.constantFrom('text', 'tëxt', '文字')
	})
	.filter((d) => d.range.startsWith('cell') === d.shape.startsWith('table'));

interface Built {
	source: string;
	from: number;
	to: number;
	/** The byte of the cell a range from a table row starts in. */
	cell: number;
}

function build(d: Draw): Built {
	const word = (line: string) => line.replace('text', d.word);
	const lines = [
		...NEIGHBOURS[d.shape].upper,
		...MIDDLES[d.middle],
		...NEIGHBOURS[d.shape].lower
	].map(word);
	const marker = (i: number) =>
		({ top: '', quote: '> ', item: i ? '  ' : '- ', 'quote in item': i ? '  > ' : '- > ' })[d.wrap];
	let source = ['', `intro${d.eol}${d.eol}`, `intro${d.eol}${d.eol}more${d.eol}${d.eol}`][d.lead];
	const texts = lines.map((line, i) => {
		const at = source.length + marker(i).length;
		source += marker(i) + line + d.eol;
		return at;
	});
	const wrapEnd = source.length - d.eol.length;
	const last = source.length + d.eol.length;
	source += d.eol + (d.tail ? MIDDLES.fence.join(d.eol).replace('x', 'last') : 'last') + d.eol;
	const upper = NEIGHBOURS[d.shape].upper.length;
	const lower = upper + MIDDLES[d.middle].length;
	const mid = (i: number) => texts[i] + Math.max(1, lines[i].length >> 1);
	const [from, to] = {
		'edge..lower': [texts[upper], texts[lower]],
		'edge..lower mid': [texts[upper], mid(lower)],
		'edge..wrap end': [texts[upper], wrapEnd],
		'edge..last': [texts[upper], last],
		'upper mid..lower': [mid(upper - 1), texts[lower]],
		'cell..middle': [-1, texts[upper]],
		'cell..lower': [-1, texts[lower]]
	}[d.range];
	return { source, from, to, cell: source.indexOf('| 1 |') + 2 };
}

// ── One draw, over the range and step by step ────────────────────────────────

/** Where a removal left the caret: a gap, text a letter joins, other bytes of a block, or none. */
type Landing = 'gap' | 'prose' | 'syntax' | 'none';

interface Side {
	source: string;
	blocks: string;
	tree: string | null;
	warns: string[];
}

interface Run {
	built: Built;
	/** The range's first byte, as the removal reads it. */
	start: number;
	over: Side;
	/** The removal alone, then the same gesture. */
	removed: Side & { landing: Landing; boundary: boolean };
	step: Side;
	took: boolean;
	/** The blocks `source` opens as in the drawn editor's grammar, blank lines aside. */
	read(source: string): string;
}

async function key(editor: Editor, init: KeyboardEventInit): Promise<void> {
	await pressHardwareKey(document.activeElement as HTMLElement, init);
	await editor.settle();
}

async function gesture(editor: Editor, g: Draw['gesture']): Promise<void> {
	if (g === 'Enter') return key(editor, { key: 'Enter' });
	if (g === 'letter') return key(editor, { key: TEXT.letter });
	if (g === 'paste') await pasteGesture(editor, { 'text/plain': TEXT.paste }, 'key');
	// With no caret left anywhere, the IME has nowhere to write, as the text dropped reads.
	else
		await insertBy('composition', document.activeElement as HTMLElement, TEXT.composition).catch(
			() => {}
		);
	await editor.settle();
}

function sideOf(editor: Editor): Side {
	const source = editor.source();
	return {
		source,
		blocks: JSON.stringify(blocksIn(editor)),
		tree: source && reloadDivergence(editor.instance.__test.getDocument(), source),
		warns: [...new Set(takeDevWarns().map((w) => w.tag))]
	};
}

function landingOf(editor: Editor): Landing {
	if (editor.instance.__test.getGapCaret()) return 'gap';
	const caret = editor.instance.getSelection()?.focus;
	const leaf = caret && blockNodeAt(editor.instance.__test.getDocument(), caret.path);
	if (!caret || !leaf) return 'none';
	return readsAsText(leaf, caret.offset) ? 'prose' : 'syntax';
}

/** Whether a block boundary stands at byte `at` of `doc`: no block's own text runs on both sides. */
function boundaryAt(doc: Parameters<typeof measured>[0], at: number): boolean {
	const point = pointAtByte(measured(doc), at);
	const leaf = point && blockNodeAt(doc, point.path);
	return !leaf || point.offset === 0 || point.offset >= leaf.raw.trimEnd().length;
}

/** Mounts `source` and puts the drawn range down; null where the editor won't hold it. */
async function placed(d: Draw, built: Built) {
	const editor = mountCase(built.source, d.mode);
	await editor.settle();
	const doc = editor.instance.__test.getDocument();
	const m = measured(doc);
	const cell = built.from < 0 ? pointAtByte(m, built.cell) : null;
	const anchor = cell ? cellPoint(cell.path.slice(0, -2), 1) : pointAtByte(m, built.from);
	const focus = pointAtByte(m, built.to);
	if (!anchor || !focus || !(await placeOwnedRange(editor, { anchor, focus }))) return null;
	const range = removalBytes(
		doc,
		rangeCoverage(doc, coverRange(doc, anchor, focus)),
		documentLayout(m)
	);
	takeDevWarns();
	return { editor, start: range?.from ?? -1 };
}

async function run(d: Draw): Promise<Run | 'unplaced'> {
	const built = build(d);
	const over = await placed(d, built);
	if (!over) return 'unplaced';
	seen.length = 0;
	await gesture(over.editor, d.gesture);
	const took = seen.some((s) => s.took);
	const overSide = sideOf(over.editor);
	const grammar = over.editor.instance.__test.getGrammar();
	const read = (source: string) =>
		JSON.stringify(blocksOf(readAsOpened(source, { grammar, scope: 'document' }).children));
	await destroyMountedEditors();
	const step = await placed(d, built);
	if (!step) return 'unplaced';
	if (d.gesture === 'letter' || d.gesture === 'paste')
		await clipboardGesture(step.editor, 'cut', 'key');
	else await key(step.editor, { key: d.gesture === 'Enter' ? 'Backspace' : 'Delete' });
	const removedSide = sideOf(step.editor);
	const removed = {
		...removedSide,
		landing: landingOf(step.editor),
		boundary: boundaryAt(
			readAsOpened(removedSide.source, { grammar, scope: 'document' }),
			over.start
		)
	};
	await gesture(step.editor, d.gesture);
	const stepSide = sideOf(step.editor);
	await destroyMountedEditors();
	return { built, start: over.start, over: overSide, removed, step: stepSide, took, read };
}

// ── The law ──────────────────────────────────────────────────────────────────

const unmarked = (text: string) => text.replace(/[\s>]+$/, '');

/** What breaks the law in `r`, one line each; empty where it holds. */
function violations(d: Draw, r: Run): string[] {
	const out: string[] = [];
	if (r.over.tree) out.push(`tree: ${r.over.tree}`);
	const { landing, boundary } = r.removed;
	// With no boundary where the range started, the text joins the text there, as after the removal.
	if (d.gesture === 'Enter' || landing === 'gap' || landing === 'prose' || !boundary) {
		if (r.over.blocks !== r.step.blocks)
			out.push('over the range is not the removal, then the gesture');
		return out;
	}
	const text = TEXT[d.gesture];
	const at = r.over.source.indexOf(text);
	if (at < 0) return [...out, 'the text was dropped'];
	if (unmarked(r.over.source.slice(0, at)) !== unmarked(r.built.source.slice(0, r.start)))
		out.push('the text stands away from where the range started');
	const without = r.over.source.slice(0, at) + r.over.source.slice(at + text.length);
	if (r.read(without) !== r.read(r.removed.source))
		out.push('the text changed what the removal left');
	if (!r.over.blocks.includes(JSON.stringify(['paragraph', text])))
		out.push('the text joined a block instead of standing in its own paragraph');
	return out;
}

// ── The violations known today ───────────────────────────────────────────────

interface Known {
	/** What's broken, and the slice or the minor that owns it. */
	cause: string;
	matches(d: Draw, r: Run, line: string): boolean;
	/** A draw it holds for, which the fixed run always takes. */
	example: Draw;
}

const texts = (d: Draw) => d.gesture !== 'Enter';
const draw = (
	shape: string,
	middle: string,
	wrap: Draw['wrap'],
	range: Draw['range'],
	gesture: Draw['gesture'],
	mode: PresentationMode = 'source'
): Draw => ({ shape, middle, wrap, range, gesture, mode, eol: '\n', lead: 1, word: 'text' });

const KNOWN: Record<string, Known> = {
	'a stale command claim': {
		cause:
			'commandLandingKind reads the kind of the block the removal lands in before the removal ' +
			'(this lane, slice 3)',
		matches: (d, _r, line) =>
			d.gesture === 'Enter' && line === 'warn: invariant:command-key-landing',
		example: draw('htmlBlocks', 'rule', 'top', 'edge..last', 'Enter')
	},
	'an opener kept in an item': {
		cause:
			'in live mode, in a list item, a range from the first byte of a fence into the indented ' +
			'code below keeps the fence, and the text goes into its body (minor)',
		matches: (d, _r, line) =>
			d.mode === 'live' &&
			d.wrap === 'item' &&
			d.shape === 'indentedCode' &&
			d.middle === 'fence' &&
			texts(d) &&
			/^the text|^over the range/.test(line),
		example: { ...draw('indentedCode', 'fence', 'item', 'edge..lower', 'letter', 'live'), lead: 0 }
	},
	"a lone block's emptied line": {
		cause:
			'text over a rule or a fence held alone between two lines keeps its emptied line, and the ' +
			'text joins the line below, which no longer joins the line above (minor)',
		matches: (d, _r, line) =>
			texts(d) &&
			d.range === 'edge..lower' &&
			(d.middle === 'rule' || d.middle === 'fence') &&
			['paragraphs', 'lazyQuote', 'lazyItem', 'startedTitle'].includes(d.shape) &&
			/^over the range|^the text changed/.test(line),
		example: draw('lazyQuote', 'rule', 'top', 'edge..lower', 'letter', 'live')
	},
	'a letter where two indented code blocks join': {
		cause:
			"text over a line between two indented code blocks goes through the joined block's typing " +
			'write, which keeps it a line of its own, where a letter typed after the removal joins the ' +
			'line below (minor)',
		matches: (d, _r, line) =>
			d.shape === 'indentedCode' &&
			d.range === 'edge..lower' &&
			(d.gesture === 'letter' || d.gesture === 'paste') &&
			line.startsWith('over the range'),
		example: draw('indentedCode', 'heading', 'top', 'edge..lower', 'letter')
	},
	'a live caret past a hidden marker': {
		cause:
			"in live mode the removal's caret moves past a heading's hidden marker, so the text then " +
			'joins the heading, where text over the range opens a paragraph before it (minor)',
		matches: (d, r, line) =>
			texts(d) &&
			d.mode === 'live' &&
			d.middle === 'heading' &&
			r.removed.landing === 'prose' &&
			line.startsWith('over the range'),
		example: draw('tableHalves', 'heading', 'top', 'cell..middle', 'composition', 'live')
	},
	'Enter from a table in a container': {
		cause: "Enter from a table's cell in a quote or an item to the block below (minor)",
		matches: (d, _r, line) =>
			d.wrap !== 'top' &&
			d.range === 'cell..middle' &&
			d.gesture === 'Enter' &&
			line.startsWith('over the range'),
		example: { ...draw('tableHalves', 'fence', 'item', 'cell..middle', 'Enter'), lead: 0 }
	},
	'a gesture that reached nothing': {
		cause: "jsdom aims the gesture at an element that isn't the range's (undetermined)",
		matches: (d, r, line) =>
			d.gesture === 'composition' &&
			d.range === 'cell..middle' &&
			r.over.source === r.built.source &&
			/^over the range|dropped$/.test(line),
		example: draw('tableHalves', 'rule', 'item', 'cell..middle', 'composition')
	},
	'a paste into a block with no paste surface': {
		cause:
			'the paste dispatch names the default hooks it takes in indented code, HTML, a definition',
		matches: (d, _r, line) => d.gesture === 'paste' && line === 'warn: paste-dispatch',
		example: draw('htmlBlocks', 'rule', 'quote', 'upper mid..lower', 'paste')
	}
};

/** Draws that reach the place a removal took its start block from, the class's own rows. */
const REACH: Record<string, Draw> = {
	'before an HTML block': draw('htmlBlocks', 'heading', 'top', 'edge..lower', 'composition'),
	'before an HTML block in a quote': draw(
		'htmlUnderText',
		'heading',
		'quote',
		'edge..lower',
		'composition'
	),
	'under a started title': draw('startedTitle', 'heading', 'top', 'edge..lower mid', 'letter'),
	// Both once read wrong: the removal folded the lines into the title, and Enter split inside it.
	'the line under it, under a started title': draw(
		'startedTitle',
		'heading',
		'top',
		'edge..lower',
		'composition'
	),
	'Enter under a started title': draw('startedTitle', 'heading', 'top', 'edge..lower mid', 'Enter'),
	'two containers deep, out past both': {
		...draw('paragraphs', 'heading', 'quote in item', 'edge..last', 'composition'),
		tail: 'fence'
	},
	'past the rows of a table': {
		...draw('tableRows', 'fence', 'top', 'cell..middle', 'composition'),
		lead: 0
	}
};

/** Every draw the fixed run always takes, by name. */
const EXAMPLES: Record<string, Draw> = {
	...Object.fromEntries(Object.entries(KNOWN).map(([name, k]) => [name, k.example])),
	...REACH
};

// ── The property ─────────────────────────────────────────────────────────────

const DRAWS = Number(process.env.HELD_GAP_DRAWS ?? 40);
const SEED = freshOrFixedSeed(20261112);
const FIXED = DRAWS === 40 && SEED === 20261112;
/** The fixed run's draws by what they met: a class here going to 0 or growing is a change to read. */
const FIXED_TALLY = {
	unplaced: 0,
	'took the start block': 30,
	'a stale command claim': 8,
	'an opener kept in an item': 1,
	"a lone block's emptied line": 2,
	'a letter where two indented code blocks join': 1,
	'a live caret past a hidden marker': 1,
	'Enter from a table in a container': 1,
	'a gesture that reached nothing': 1,
	'a paste into a block with no paste surface': 2
};

/** What each example leaves over the range. */
const LANDED: Record<string, string> = {
	'a stale command claim': 'intro\n\n<!-- a -->\n\n\nlast\n',
	'an opener kept in an item': '-     a\n  ```\nж\n  ```\n    b\n\nlast\n',
	"a lone block's emptied line": 'intro\n\n> quoted\n\nжlazy\n\nlast\n',
	'a letter where two indented code blocks join': 'intro\n\n    a\nж\n    b\n\nlast\n',
	'a live caret past a hidden marker': 'intro\n\n汉\n\n# h\n| 2 |\n\nlast\n',
	'Enter from a table in a container': '- \n- \n  ```\n  x\n  ```\n  | 2 |\n\nlast\n',
	'a gesture that reached nothing': 'intro\n\n- | a |\n  | - |\n  | 1 |\n  ***\n  | 2 |\n\nlast\n',
	'a paste into a block with no paste surface': 'intro\n\n> <!-- ж\n> <div>\n> x\n\nlast\n',
	'before an HTML block': 'intro\n\n<!-- a -->\n\n汉\n\n<div>\nx\n\nlast\n',
	'before an HTML block in a quote': 'intro\n\n> text\n>\n> 汉\n>\n> <span class="x">\n\nlast\n',
	'under a started title': "intro\n\n[a]: /u\n    'code\n\nжxt\nend'\n\nlast\n",
	'the line under it, under a started title':
		"intro\n\n[a]: /u\n    'code\n\n汉text\nend'\n\nlast\n",
	'Enter under a started title': "intro\n\n[a]: /u\n    'code\n\n\nxt\nend'\n\nlast\n",
	'two containers deep, out past both':
		'intro\n\n- > above\n  > \n  > 汉\n  >\n  >\n\n```\nlast\n```\n',
	'past the rows of a table': '| a |\n| - |\n\n汉\n\n```\nx\n```\n| 2 |\n\nlast\n'
};

describe('text and Enter over a range whose removal reads a neighbour again', () => {
	it('leave what the law says, save the violations known today', async () => {
		const tally: Record<string, number> = { unplaced: 0, 'took the start block': 0 };
		const unknown: string[] = [];
		const names = new Map(Object.entries(EXAMPLES).map(([name, d]) => [JSON.stringify(d), name]));
		const landed: Record<string, string> = {};
		await fc.assert(
			fc.asyncProperty(arbDraw, async (d) => {
				const r = await run(d);
				if (r === 'unplaced') return void tally.unplaced++;
				if (r.took) tally['took the start block']++;
				const example = names.get(JSON.stringify(d));
				if (example) landed[example] = r.over.source;
				const warns = [...r.over.warns, ...r.removed.warns, ...r.step.warns];
				const classes = new Set<string>();
				for (const line of [...violations(d, r), ...warns.map((tag) => `warn: ${tag}`)]) {
					const known = Object.entries(KNOWN).find(([, k]) => k.matches(d, r, line))?.[0];
					if (known) classes.add(known);
					else unknown.push(`${line}: ${JSON.stringify(d)}\n${r.over.source}`);
				}
				for (const name of classes) tally[name] = (tally[name] ?? 0) + 1;
			}),
			{
				numRuns: DRAWS + Object.keys(EXAMPLES).length,
				seed: SEED,
				examples: Object.values(EXAMPLES).map((d) => [d])
			}
		);
		if (process.env.HELD_GAP_TALLY)
			appendFileSync(process.env.HELD_GAP_TALLY, `${JSON.stringify({ tally, unknown, landed })}\n`);
		expect(unknown).toEqual([]);
		for (const name of Object.keys(KNOWN)) expect(tally[name], `${name} fired`).toBeGreaterThan(0);
		if (FIXED) expect(tally).toEqual(FIXED_TALLY);
		// A declared draw that gets worse, or a taken place that moves, shows here.
		expect(landed).toEqual(LANDED);
	}, 600_000);
});
