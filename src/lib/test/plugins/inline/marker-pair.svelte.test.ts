// @vitest-environment jsdom
// A plugin's marker pair: each side is claimed alone, draws nothing where markers hide, gives a
// letter typed at it to the side its pair calls its text, and a key beside it skips it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	definePlugin,
	markerPair,
	type MarkerPair,
	type MarkerPairSpec,
	type MarkerSide
} from '#lib/plugin.js';
import { readInline } from '#lib/core/inline/scan/index.js';
import { renderInlineNodes } from '#lib/core/inline-render.js';
import { paintsOnlyChrome, renderedText, screenVisibility } from '#lib/core/inline/visibility.js';
import { cutOutsideWhole } from '#lib/core/inline/live-edit/live-split.js';
import { hiddenEdges } from '#lib/components/blocks/text/edge-seat.js';
import { resolveEdgeDeletion } from '#lib/components/blocks/text/construct-edge-delete.js';
import type { DeleteDirection } from '#lib/browser/input.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installInlines } from '#lib/schema/inline-type.js';
import {
	getInlineConstructPolicy,
	holdInlineConstructPolicy,
	markerSideEdge
} from '#lib/schema/inline-construct-policy.js';
import { makeBlockNode, type AnyInlineKind, type InlineNode } from '#lib/core/nodes.js';
import { splitHalves } from '#lib/tree-operations/node-ops.js';
import { fixtureReading, topLevelSplit, topLevelStore } from '#lib/test/harness/fixture-grammar.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

beforeEach(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

type Text = NonNullable<MarkerPairSpec<unknown>['text']>;

/** A comment anchor: `{>>id}` opens, `{<<id}` closes, the id is what the plugin pairs them by. */
const anchor = (text?: Text) =>
	markerPair({
		name: 'anchor',
		label: 'Comment anchor',
		open: { prefix: '{>>', match: /\{>>([\w-]+)\}/, read: (m) => ({ id: m[1] }) },
		close: { prefix: '{<<', match: /\{<<([\w-]+)\}/, read: (m) => ({ id: m[1] }) },
		...(text && { text }),
		sample: 'a {>>c}text{<<c} z'
	});

function installed(text?: Text, pair: MarkerPair = anchor(text)) {
	const { inlines, release } = installInlines(
		[
			{
				name: 'cm',
				plugin: { name: 'cm', version: '1.0.0', editor: '*' },
				contribution: { inlines: [pair] }
			}
		],
		() => {}
	);
	const grammar = createEditorGrammar({ inlines: () => inlines });
	const reading = fixtureReading({ grammar });
	const read = (raw: string) => readInline(raw, 0, raw.length, undefined, grammar);
	return { pair, grammar, reading, read, release };
}

const LIVE = screenVisibility('live', { chromePaints: false });
const SOURCE = screenVisibility('source', { chromePaints: false });

// `a {>>c}text{<<c} z`: the open side is [2,7), the text [7,11), the close side [11,16).
const PAIR = 'a {>>c}text{<<c} z';

describe('a marker pair, read', () => {
	it('claims each side alone, with what its matcher read', () => {
		const { read } = installed();
		expect(read(PAIR)).toMatchObject([
			{ kind: 'text' },
			{ kind: 'cm/anchor-open', start: 2, end: 7, data: { id: 'c' } },
			{ kind: 'text', start: 7, end: 11 },
			{ kind: 'cm/anchor-close', start: 11, end: 16, data: { id: 'c' } },
			{ kind: 'text' }
		]);
	});

	it('claims a side with no partner, and in any order', () => {
		const { read } = installed();
		expect(read('a {<<x} b {>>y}').map((n) => n.kind)).toEqual([
			'text',
			'cm/anchor-close',
			'text',
			'cm/anchor-open'
		]);
	});

	// Miss-analysis: every row passed its spec as a literal reading a string id, so nothing passed
	// one typed as the exported `MarkerPairSpec`, which no overload took, or read another shape.
	it('takes a spec typed as `MarkerPairSpec`, reading data of any shape', () => {
		const side = (prefix: string): MarkerSide<{ n: number }> => ({
			prefix,
			match: new RegExp(`\\{${prefix.slice(1)}(\\d+)\\}`),
			read: (m: RegExpExecArray) => ({ n: Number(m[1]) })
		});
		const spec: MarkerPairSpec<{ n: number }> = {
			name: 'anchor',
			label: 'Numbered anchor',
			open: side('{>>'),
			close: side('{<<'),
			sample: 'a {>>7}text{<<7} z'
		};
		const { read } = installed(undefined, markerPair(spec));
		expect(read('a {>>7}text{<<7} z').map((n) => n.data)).toEqual([
			undefined,
			{ n: 7 },
			undefined,
			{ n: 7 },
			undefined
		]);
	});

	it('is named after its plugin, a side each', () => {
		const { pair } = installed();
		expect([pair.name, pair.open.name, pair.close.name]).toEqual([
			'cm/anchor',
			'cm/anchor-open',
			'cm/anchor-close'
		]);
	});

	it('holds a row for each side while an editor runs it', () => {
		const { release } = installed();
		const row = (kind: string) => getInlineConstructPolicy(kind as AnyInlineKind);
		expect(row('cm/anchor-open')).toEqual({
			edgeAffinity: 'joins-after',
			autoUnwrapOnEmpty: false,
			splitBehavior: 'whole',
			revealable: true,
			prose: 'none'
		});
		expect(row('cm/anchor-close')?.edgeAffinity).toBe('joins-before');
		release();
		expect(row('cm/anchor-open')).toBeUndefined();
	});

	// Miss-analysis: the counter rows counted marker-run reads and table builds, never the row a
	// side question read for each construct of a block in an editor listing no pair.
	it('asks no row for a side while no editor lists a pair', () => {
		let read = 0;
		const release = holdInlineConstructPolicy('probe/counted' as AnyInlineKind, {
			get edgeAffinity() {
				read++;
				return 'left-sticky' as const;
			},
			autoUnwrapOnEmpty: false,
			splitBehavior: 'plain',
			revealable: false
		});
		const node = (kind: string) => ({ kind, start: 2, end: 7 }) as InlineNode;
		const first = installed();
		const second = installed();
		first.release();
		expect(markerSideEdge(node('cm/anchor-open'))).toEqual({ start: 7, end: 7 });
		second.release();
		expect(markerSideEdge(node('cm/anchor-open'))).toBeNull();
		// Both editors gone: the count is back at none, and no row is read.
		read = 0;
		expect(markerSideEdge(node('probe/counted'))).toBeNull();
		expect(read).toBe(0);
		release();
	});

	it('draws nothing where markers hide, and its bytes where they show', () => {
		const { read, grammar } = installed();
		const nodes = read(PAIR);
		expect(renderedText(nodes, PAIR, LIVE, { grammar })).toBe('a text z');
		expect(renderedText(nodes, PAIR, SOURCE, { grammar })).toBe(PAIR);
	});

	// Markers standing over nothing stay on screen (live-mode.md § 4.1), a side's included.
	it('shows its sides on a line holding nothing else', () => {
		const { read, grammar } = installed();
		for (const line of ['{>>c}', '{>>c}{<<c}']) {
			expect(paintsOnlyChrome(read(line), line, { grammar })).toBe(true);
		}
		expect(paintsOnlyChrome(read(PAIR), PAIR, { grammar })).toBe(false);
	});

	it('tags its marker so preview-inline shows it at the caret', () => {
		const { read, grammar } = installed();
		const frag = renderInlineNodes(read(PAIR), PAIR, { grammar, tagConstructMarkers: true });
		const sides = [...frag.querySelectorAll('.md-marker')];
		expect(sides.map((s) => [s.textContent, s.getAttribute('data-construct-start')])).toEqual([
			['{>>c}', '2'],
			['{<<c}', '11']
		]);
	});

	it('a flood of unclosed sides scans within a bounded growth ratio', () => {
		const { read } = installed();
		expectBoundedGrowth(measureScanGrowth((raw) => void read(raw), '{>>a ', [16, 64]));
	}, 300_000);
});

// Where a letter typed at a side lands: the side its pair calls its text, from either raw offset
// of the one screen position, unless the caret memory's record says otherwise.
describe('a letter typed at a side', () => {
	function seat(source: string, caret: number, record: EdgeAffinity | null = null, text?: Text) {
		const { read, reading } = installed(text);
		return hiddenEdges(read(source), source, LIVE, reading).typingOffset(caret, record);
	}
	const both = (source: string, offsets: number[], text?: Text) =>
		offsets.map((at) => seat(source, at, null, text));

	it.each<[string, Text | undefined, number, number]>([
		['the text between them, by default', undefined, 7, 11],
		['after the open side and after the close side', { open: 'after', close: 'after' }, 7, 16],
		['before both', { open: 'before', close: 'before' }, 2, 11],
		['outside both', { open: 'before', close: 'after' }, 2, 16]
	])('joins %s', (_name, text, open, close) => {
		expect(both(PAIR, [2, 7], text)).toEqual([open, open]);
		expect(both(PAIR, [11, 16], text)).toEqual([close, close]);
	});

	it('lands outside after a fresh start or a typed closer', () => {
		expect(seat(PAIR, 7, 'outside')).toBe(2);
		expect(seat(PAIR, 11, 'outside')).toBe(16);
	});

	it('lands at a pinned offset the position holds', () => {
		expect(seat(PAIR, 7, { offset: 2 })).toBe(2);
	});

	// `a {>>c}{<<c} z`: the open side is [2,7), the close side [7,12).
	it('holds the caret between the two sides of an empty pair', () => {
		expect(both('a {>>c}{<<c} z', [2, 7, 12])).toEqual([7, 7, 7]);
	});

	it('joins the text at a line start and a line end', () => {
		expect(both('{>>c}text', [0, 5])).toEqual([5, 5]);
		expect(both('text{<<c}', [4, 9])).toEqual([4, 4]);
	});

	// Miss-analysis: every landing row held one side a position; two anchors on one word, sides at
	// [2,7) [7,12) and [16,21) [21,26), were never drawn, and mid-line the letter missed both.
	it('joins the text of every side stacked at one position', () => {
		const source = 'x {>>a}{>>b}text{<<b}{<<a} y';
		expect(both(source, [2, 7, 12])).toEqual([12, 12, 12]);
		expect(both(source, [16, 21, 26])).toEqual([16, 16, 16]);
		expect(seat(source, 12, 'outside')).toBe(2);
		expect(seat(source, 16, 'outside')).toBe(26);
	});

	// `a {>>c}**bold**{<<c} z`: the open side [2,7) meets the bold's opener [7,9), its closer
	// [13,15) meets the close side [15,20).
	it('joins the text and leaves a bold beside it to the character before', () => {
		const source = 'a {>>c}**bold**{<<c} z';
		expect(both(source, [2, 7, 9])).toEqual([7, 7, 7]);
		expect(both(source, [13, 15, 20])).toEqual([13, 13, 13]);
	});
});

describe('a key beside a side', () => {
	function del(display: string, caret: number, direction: DeleteDirection = 'backward') {
		const { read, reading } = installed();
		return resolveEdgeDeletion({
			display,
			asWritten: (text) => text,
			content: { start: 0, end: display.length },
			caret,
			direction,
			screen: LIVE,
			inlines: read(display),
			store: topLevelStore(
				makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: display }),
				reading
			)
		});
	}

	it('takes the character the user sees, never the side', () => {
		for (const caret of [2, 7]) {
			expect(del(PAIR, caret)).toEqual({ raw: 'a{>>c}text{<<c} z', caret: 1, unwrappedMarks: [] });
		}
		for (const caret of [2, 7]) {
			expect(del(PAIR, caret, 'forward')).toMatchObject({ raw: 'a {>>c}ext{<<c} z' });
		}
	});

	it('empties the pair and keeps both sides', () => {
		expect(del('a {>>c}t{<<c} z', 8)).toEqual({
			raw: 'a {>>c}{<<c} z',
			caret: 7,
			unwrappedMarks: []
		});
	});

	it('cuts a side whole: a cut inside one moves to its nearer edge', () => {
		const { reading } = installed();
		const node = makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: `${PAIR}\n` });
		expect([3, 4, 5, 13].map((at) => cutOutsideWhole(node, at, reading))).toEqual([2, 2, 7, 11]);
	});

	// Live Enter at a side, from either raw offset of its screen position.
	it('Enter beside a side leaves it on the half with its text', () => {
		const { reading } = installed();
		const live = fixtureReading({ grammar: reading.grammar }, 'live');
		const node = makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: `${PAIR}\n` });
		const enter = (at: number) => {
			const halves = splitHalves(node, at, undefined, '\n', topLevelSplit(node, live));
			return [halves.firstRaw, halves.secondRaw];
		};
		for (const at of [2, 7]) expect(enter(at)).toEqual(['a \n', '{>>c}text{<<c} z\n']);
		for (const at of [11, 16]) expect(enter(at)).toEqual(['a {>>c}text{<<c}\n', ' z\n']);
	});

	// Miss-analysis: the Enter rows cut at a lone side's two offsets, never at the third that a
	// bold, a code span, a link or a second side gives the position, where a side lost its text.
	it.each<[string, number[], number[]]>([
		['x {>>a}{>>b}text{<<b}{<<a} y', [2, 7, 12], [16, 21, 26]],
		['a {>>c}**bold**{<<c} z', [2, 7, 9], [13, 15, 20]],
		['a {>>c}`code`{<<c} z', [2, 7, 8], [12, 13, 18]],
		['a {>>c}<http://x.dev>{<<c} z', [2, 7, 9], [19, 21, 26]],
		['x {>>a}[link](u){<<a} y', [2, 7, 8], [12, 16, 21]]
	])(
		'Enter at any offset of the position of a side in %s strands none',
		(source, opens, closes) => {
			const { reading } = installed();
			const live = fixtureReading({ grammar: reading.grammar }, 'live');
			const node = makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: `${source}\n` });
			const enter = (at: number) => {
				const halves = splitHalves(node, at, undefined, '\n', topLevelSplit(node, live));
				return [halves.firstRaw, halves.secondRaw];
			};
			const cut = source.length - 2;
			for (const at of opens) {
				expect(enter(at), `at ${at}`).toEqual([`${source.slice(0, 2)}\n`, `${source.slice(2)}\n`]);
			}
			for (const at of closes) {
				expect(enter(at), `at ${at}`).toEqual([
					`${source.slice(0, cut)}\n`,
					`${source.slice(cut)}\n`
				]);
			}
		}
	);

	// `**a {>>c}b**`: the open side [4,9) sits inside the bold, which a cut there closes and reopens.
	it('inside a bold, a letter joins both, and Enter reopens the bold around the side', () => {
		const { read, reading } = installed();
		const source = '**a {>>c}b**';
		const live = fixtureReading({ grammar: reading.grammar }, 'live');
		const node = makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: `${source}\n` });
		const edges = hiddenEdges(read(source), source, LIVE, reading);
		for (const at of [4, 9]) {
			expect(edges.typingOffset(at, null)).toBe(9);
			const halves = splitHalves(node, at, undefined, '\n', topLevelSplit(node, live));
			expect([halves.firstRaw, halves.secondRaw]).toEqual(['**a** \n', '**{>>c}b**\n']);
		}
	});
});

describe('a marker pair in a mounted editor', () => {
	const plugin = definePlugin({
		name: 'cm',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inlines: [anchor()] })
	});

	it('draws each side as a marker, in two blocks', async () => {
		const source = 'one {>>c}start\n\nend{<<c} two\n';
		const editor = mountEditor({ source, plugins: [plugin], presentationMode: 'live' });
		await editor.settle();
		const markers = (path: number[]) =>
			[...blockHostAt(editor, path).querySelectorAll('.md-marker')].map((m) => m.textContent);
		expect([markers([0]), markers([1])]).toEqual([['{>>c}'], ['{<<c}']]);
	});

	// The same key in an editor listing no pair, where the bytes are text and stay where typed.
	it.each([
		['beside a side', [plugin], 'a {>>c}Xtext{<<c} z\n'],
		['in an editor listing no pair', [], 'a X{>>c}text{<<c} z\n']
	])(
		'a letter typed %s reads its block once and builds no table',
		async (_name, plugins, after) => {
			const editor = mountEditor({ source: `${PAIR}\n`, plugins, presentationMode: 'live' });
			await editor.settle();
			const el = surfaceAt(editor, [0]);
			placeCaret(el, 2);
			resetPerfInstruments();
			enablePerfInstruments();
			try {
				el.textContent = 'a X{>>c}text{<<c} z';
				placeCaret(el, 3);
				el.dispatchEvent(new InputEvent('input', { bubbles: true }));
				await editor.settle();
				expect(editor.source()).toBe(after);
				expect(perfSnapshot().markerRunReads).toBe(1);
				expect(perfSnapshot().inlineTableBuilds).toBe(0);
			} finally {
				disablePerfInstruments();
			}
		}
	);
});
