// @vitest-environment jsdom
// The caret's promise is what typing delivers: over random formatted lines, carets, modes, hosts
// and caret memories, the marks the drawn caret paints are the marks the next typed letter gets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '#lib/core/nodes.js';
import { parseInline } from '#lib/core/inline/index.js';
import { listInlineMarks } from '#lib/schema/inline-construct-policy.js';
import {
	normalizeLinkLabel,
	type LinkReferenceResolver
} from '#lib/core/inline/link-reference-resolver.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { installLayoutStubs, mountEditor } from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import {
	INSERTION_ROUTES,
	TEXT_HOSTS,
	insertBy,
	type InsertionRoute
} from '#lib/test/harness/insertion-routes.js';
import {
	caretMarks,
	installDrawnCaretStubs,
	paintCaret,
	type DrawnCaretSeam
} from '#lib/test/harness/drawn-caret-jsdom.js';
import { freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 250, seed: freshOrFixedSeed(791791) } as const;

/** Typed after the caret is painted; the generator never writes it, so it is found by search. */
const LETTER = 'a';

let restoreStubs: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreStubs = installDrawnCaretStubs();
});
afterAll(() => restoreStubs());

// ── The lines ────────────────────────────────────────────────────────────────

const word = fc
	.array(fc.constantFrom('b', 'c', 'd', 'é', '日'), { minLength: 1, maxLength: 3 })
	.map((letters) => letters.join(''));

/** Awkward shapes: an escape, an image, a surrogate pair, an empty pair, an intraword underscore,
 *  tags one letter short of valid HTML, labels the document defines, and closers that don't close. */
const leaf = fc.oneof(
	{ weight: 4, arbitrary: word },
	fc.constant('😀'),
	fc.constant('\\*'),
	fc.constant('![i](x.png)'),
	fc.constant('****'),
	fc.constant('b_c_d'),
	fc.constant('<b 1c="*">'),
	fc.constant('<b x=">" 1c="*">'),
	fc.constant('[foo*]'),
	fc.constant('[foo\\]b*]'),
	fc.constant('[c `]` d*]')
);

/** Defines two of those labels for every case, in a block of its own after the line. */
const DEFINITION = '\n[foo*]: /u\n[foo\\]b*]: /u\n';
const DEFINED = new Set(['foo*', 'foo\\]b*']);
const RESOLVE_DEFINED: LinkReferenceResolver = (label) =>
	DEFINED.has(normalizeLinkLabel(label)) ? { url: '/u' } : undefined;

const { inline } = fc.letrec<{ inline: string; wrapped: string; joined: string }>((tie) => ({
	inline: fc.oneof(
		{ depthSize: 'small', withCrossShrink: true },
		leaf,
		tie('wrapped'),
		tie('joined')
	),
	wrapped: fc.oneof(
		fc
			.tuple(fc.constantFrom('**', '*', '_', '~~', '***'), tie('inline'))
			.map(([delimiter, inner]) => delimiter + inner + delimiter),
		word.map((inner) => '`' + inner + '`'),
		tie('inline').map((inner) => `[${inner}](u)`)
	),
	// Joined with nothing between, two constructs abut: `**b *c***` closes two runs at once.
	joined: fc
		.tuple(tie('inline'), fc.constantFrom('', ' '), tie('inline'))
		.map(([left, gap, right]) => left + gap + right)
}));

const line = fc
	.tuple(fc.option(word), inline, fc.option(word))
	.map(([before, body, after]) => [before, body, after].filter((part) => part !== null).join(' '));

// ── The caret memory, set by real input ──────────────────────────────────────

type Memory =
	| { kind: 'none' }
	| { kind: 'arrow'; key: 'ArrowLeft' | 'ArrowRight' }
	| { kind: 'space' }
	| { kind: 'chord'; init: KeyboardEventInit };

const CHORDS: KeyboardEventInit[] = [
	{ key: 'b', ctrlKey: true },
	{ key: 'i', ctrlKey: true },
	{ key: 'X', ctrlKey: true, shiftKey: true },
	{ key: 'e', ctrlKey: true }
];

const memory = fc.oneof(
	fc.constant<Memory>({ kind: 'none' }),
	fc.constantFrom<Memory>(
		{ kind: 'arrow', key: 'ArrowLeft' },
		{ kind: 'arrow', key: 'ArrowRight' }
	),
	fc.constant<Memory>({ kind: 'space' }),
	fc.constantFrom(...CHORDS).map((init): Memory => ({ kind: 'chord', init }))
);

/** Pending marks are spent only by a hardware key and a composition; the other routes are a
 *  separate gap, so a chord types by one of these two. */
const SPENDING_ROUTES: readonly InsertionRoute[] = ['hardware key', 'composition'];

async function arrive(el: HTMLElement, state: Memory): Promise<void> {
	if (state.kind === 'arrow') await pressKey(el, { key: state.key });
	else if (state.kind === 'space') await insertBy('hardware key', el, ' ');
	else if (state.kind === 'chord') await pressKey(el, state.init);
}

// ── The check ────────────────────────────────────────────────────────────────

interface Case {
	line: string;
	caret: number;
	mode: PresentationMode;
	host: (typeof TEXT_HOSTS)[number];
	memory: Memory;
	route: InsertionRoute;
}

/** The mark kinds standing over `[at, at + 1)` in `text`, in the policy table's nesting order. */
function marksAround(text: string, at: number): string[] {
	const covering = new Set<string>();
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.start > at || at + 1 > node.end) continue;
			covering.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(text, 0, text.length, RESOLVE_DEFINED));
	return listInlineMarks()
		.map((entry) => entry.kind as string)
		.filter((kind) => covering.has(kind));
}

/** Paints the caret the case sets up, types the letter, and returns what the bar promised and what
 *  the letter got; null where the bar draws no text caret there (beside a widget, a chip's edge). */
async function promiseAndDelivery(
	c: Case
): Promise<{ promised: string[]; typed: string[]; result: string } | null> {
	const editor = mountEditor<DrawnCaretSeam>({
		source: c.host.source(c.line) + DEFINITION,
		presentationMode: c.mode
	});
	try {
		const el = c.host.el(editor);
		el.focus();
		testCaretWriter.placeCaretAtRaw(el, Math.min(c.caret, c.line.length), { clamp: 'reachable' });
		await editor.settle();
		await arrive(el, c.memory);
		// An arrow at the block's end leaves it, and the promise is then another block's.
		if (document.activeElement !== el) return null;
		await paintCaret(editor);
		const promised = caretMarks(editor);
		if (promised === null) return null;
		await insertBy(c.memory.kind === 'chord' ? spendingRoute(c.route) : c.route, el, LETTER);
		const result = c.host.line(editor.source().replace(DEFINITION, ''));
		const at = result.indexOf(LETTER);
		expect(at, `the letter never reached ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(0);
		return { promised, typed: marksAround(result, at), result };
	} finally {
		await editor.destroy();
	}
}

function spendingRoute(route: InsertionRoute): InsertionRoute {
	return SPENDING_ROUTES.includes(route) ? route : 'hardware key';
}

/** False where the bar drew no text caret in the case's block, so there was no promise to check. */
async function expectPromiseKept(c: Case): Promise<boolean> {
	const outcome = await promiseAndDelivery(c);
	if (!outcome) return false;
	const { host, ...shown } = c;
	expect(
		outcome.promised,
		`${JSON.stringify({ ...shown, host: host.name })} typed ${JSON.stringify(outcome.result)}`
	).toEqual(outcome.typed);
	return true;
}

const MODES: PresentationMode[] = ['live', 'source', 'preview-inline'];

describe('the drawn caret’s look over generated lines', () => {
	it('paints the marks the next typed letter gets', async () => {
		await fc.assert(
			fc.asyncProperty(
				line,
				fc.nat(),
				fc.constantFrom(...MODES),
				fc.constantFrom(...TEXT_HOSTS),
				memory,
				fc.constantFrom(...INSERTION_ROUTES),
				async (text, pick, mode, host, state, route) => {
					await expectPromiseKept({
						line: text,
						caret: pick % (text.length + 1),
						mode,
						host,
						memory: state,
						route
					});
				}
			),
			PARAMS
		);
	}, 60_000);
});

// Shapes the property has to reach, pinned so a generator change can't lose them.
const PINNED: [name: string, c: Omit<Case, 'host'>][] = [
	[
		'the empty pair a chord writes in source mode',
		{
			line: 'b c',
			caret: 1,
			mode: 'source',
			memory: { kind: 'chord', init: CHORDS[0] },
			route: 'hardware key'
		}
	],
	[
		'two closers abutting, at their inside end',
		{
			line: 'b **c *d*** e',
			caret: 8,
			mode: 'live',
			memory: { kind: 'none' },
			route: 'hardware key'
		}
	],
	[
		'bold italic in one run, at its inside end',
		{ line: 'b ***cd*** e', caret: 7, mode: 'live', memory: { kind: 'none' }, route: 'soft key' }
	],
	[
		'a space held at a strikethrough closer',
		{ line: 'b ~~cd~~ e', caret: 6, mode: 'live', memory: { kind: 'space' }, route: 'replacement' }
	],
	[
		'a code span inside bold',
		{
			line: 'b **c `dd` c** e',
			caret: 8,
			mode: 'preview-inline',
			memory: { kind: 'none' },
			route: 'paste'
		}
	]
];

describe.each(TEXT_HOSTS)('in $name, the look keeps its promise for', (host) => {
	it.each(PINNED)('%s', async (_name, c) => {
		expect(await expectPromiseKept({ ...c, host }), 'the bar drew a text caret').toBe(true);
	});
});
