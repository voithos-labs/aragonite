// One drawn gesture at the end of a file with no final line break, and the same gesture on the
// same file with one (its twin), each through the mounted editor's own event routes and each
// followed by a typed letter. `open-end-twin.property.test.ts` judges the pair.

import fc from 'fast-check';
import type { Document } from '#lib/core/nodes.js';
import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import {
	endsInBlankLine,
	isBlankText,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '#lib/core/lines.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { childHoldingLastLine } from '#lib/schema/container-raw.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	deleteBy,
	insertBy,
	pressHardwareKey,
	softBackspace
} from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	placeRange,
	TYPING_ROUTES,
	type Editor,
	type TypingRoute
} from '#lib/test/range-laws/gestures.js';
import { arbClipboardText, arbLawDocument, arbMode } from '#lib/test/range-laws/shapes.js';
import { sitesOf, type Site } from '#lib/test/range-laws/ranges.js';

// ── What a draw holds ────────────────────────────────────────────────────────

/** A place in a site counted back from the document's last one. */
type At = 'start' | 'line start' | 'inside' | 'end';
interface End {
	back: number;
	at: At;
	inside: number;
}

/** A caret, or a range inside one block or across blocks, and who holds an in-block range: the
 *  browser (a drag) or the editor (a finger's long press). */
export interface Where {
	from: End;
	to: End | null;
	holder: 'browser' | 'editor';
}

export type Gesture =
	| { key: 'Backspace' | 'Delete' }
	| { soft: 'Backspace' }
	| { word: 'Backspace' | 'Delete' }
	| { enter: 'Enter' | 'Shift+Enter' }
	| { letter: string; route: TypingRoute }
	| { cut: 'key' | 'then pasted back' }
	| { paste: string };

export interface Draw {
	/** The file with no final line break. */
	source: string;
	mode: PresentationMode;
	where: Where;
	gesture: Gesture;
}

/** The last blocks a file with no final line break ends on, where an emptied line shows. */
const TAILS = [
	'above\npq',
	'zz\n\nab',
	'one',
	'# head',
	'- one\n- two\n  pq',
	'1. one\n\n   pq',
	'- [ ] task\n  pq',
	'> above\n> pq',
	'> - a\n>   pq',
	'> [!NOTE]\n> a\n> pq',
	'```\npq',
	'```js\none\npq',
	'~~~\npq\n~~~',
	'    code\n    pq',
	'[^1]: a\n    pq',
	':::note\nbody\npq',
	':::note\nbody\n:::',
	'<details>\n<summary>Sum</summary>\n\nbody\npq',
	'<details>\n<summary>Sum</summary>\n\nbody\n\n</details>',
	'$$\nx\npq',
	'**bold** and\n**pq**',
	'| a | b |\n| - | - |\n| c | d |'
];

const open = (source: string) => source.replace(/(?:\r?\n)+$/, '');
const endingIn = (source: string) => (source.includes('\r\n') ? '\r\n' : '\n');
/** A file of both line endings has no one ending to give its twin; the range laws draw those. */
const mixed = (source: string) => /\r\n/.test(source) && /(?<!\r)\n/.test(source);

const arbOpenSource: fc.Arbitrary<string> = fc
	.oneof(
		{ arbitrary: arbLawDocument.map(open), weight: 2 },
		{
			arbitrary: fc
				.tuple(fc.option(arbLawDocument, { nil: '' }), fc.constantFrom(...TAILS), fc.boolean())
				.map(([above, tail, crlf]) => {
					const ending = above === '' ? (crlf ? '\r\n' : '\n') : endingIn(above);
					const body = above === '' ? '' : open(above) + ending + ending;
					return body + tail.replace(/\n/g, ending);
				}),
			weight: 3
		}
	)
	.filter((source) => source !== '' && !mixed(source));

const arbAt = fc.constantFrom<At>('start', 'line start', 'line start', 'inside', 'end', 'end');
const arbEnd = (maxBack: number): fc.Arbitrary<End> =>
	fc.record({
		back: fc.oneof({ arbitrary: fc.constant(0), weight: 4 }, fc.nat({ max: maxBack })),
		at: arbAt,
		inside: fc.nat({ max: 31 })
	});

const arbWhere: fc.Arbitrary<Where> = fc.record({
	from: arbEnd(2),
	to: fc.option(arbEnd(0), { nil: null, freq: 4 }),
	holder: fc.constantFrom<Where['holder']>('browser', 'editor')
});

const arbDelete = fc.constantFrom<'Backspace' | 'Delete'>('Backspace', 'Delete');
const arbGesture: fc.Arbitrary<Gesture> = fc.oneof(
	{ arbitrary: fc.record({ key: arbDelete }), weight: 3 },
	fc.constant<Gesture>({ soft: 'Backspace' }),
	fc.record({ word: arbDelete }),
	fc.record({ enter: fc.constantFrom<'Enter' | 'Shift+Enter'>('Enter', 'Shift+Enter') }),
	fc.record({ letter: fc.constantFrom('x', ' ', '#'), route: fc.constantFrom(...TYPING_ROUTES) }),
	{
		arbitrary: fc.record({
			cut: fc.constantFrom<'key' | 'then pasted back'>('key', 'then pasted back')
		}),
		weight: 2
	},
	fc.record({ paste: arbClipboardText })
);

export const arbDraw: fc.Arbitrary<Draw> = fc.record({
	source: arbOpenSource,
	mode: arbMode,
	where: arbWhere,
	gesture: arbGesture
});

// ── One run ──────────────────────────────────────────────────────────────────

/** What the editor holds after a step. */
export interface Step {
	/** The gesture the step followed. */
	name: string;
	source: string;
	/** The selection and the gap caret, as one comparable text. */
	caret: string;
	warns: string[];
	/** Where the tree and a reload of its bytes differ, or null. */
	diverges: string | null;
	last: LastLine;
}

/** The line the bytes end on, read down the tree as the last-line guard reads it: text, an empty
 *  line, or one the guard takes either way (an empty first paragraph on its container's marker
 *  line, a line of spaces). */
export type LastLine = 'text' | 'blank' | 'either';

export function lastLineOf(doc: DocumentView): LastLine {
	if (doc.suffix !== '') return 'blank';
	let node: NodeView | undefined = doc.children.at(-1);
	let opens = false;
	for (let holder = node ? childHoldingLastLine(node) : -1; holder >= 0;) {
		opens = holder === 0;
		node = node!.children![holder];
		holder = childHoldingLastLine(node);
	}
	if (!node || !endsInBlankLine(node.raw)) return 'text';
	if (opens && isBlankText(node.raw)) return 'either';
	const body = trimTrailingLineEnding(node.raw);
	return body === '' || body.endsWith('\n') ? 'blank' : 'either';
}

function offsetIn(site: Site, end: End): number {
	if (end.at === 'start' || site.end === site.start) return site.start;
	if (end.at === 'end') return site.end;
	const text = site.raw.slice(0, site.end);
	if (end.at === 'line start') return Math.max(site.start, text.lastIndexOf('\n') + 1);
	const at = site.start + 1 + (end.inside % (site.end - site.start));
	const splits = (i: number) =>
		(text[i - 1] === '\r' && text[i] === '\n') || /[\ud800-\udbff]/.test(text[i - 1] ?? '');
	return splits(at) ? at - 1 : at;
}

/** `where` read against `doc`; null where it names no caret or range there (a table's cells). */
function resolve(doc: Document, where: Where): EditorSelection | null {
	const sites = sitesOf(doc);
	const pick = (end: End) => sites[Math.max(0, sites.length - 1 - end.back)];
	const first = sites.length > 0 ? pick(where.from) : undefined;
	if (!first || first.cells) return null;
	const from = { path: first.path, offset: offsetIn(first, where.from) };
	if (!where.to) return { anchor: from, focus: from };
	const last = pick(where.to);
	if (last.cells) return null;
	const to = { path: last.path, offset: offsetIn(last, where.to) };
	if (first !== last) return { anchor: from, focus: to };
	if (from.offset === to.offset) {
		if (first.start === first.end) return { anchor: from, focus: from };
		return { anchor: { ...from, offset: first.start }, focus: { ...to, offset: first.end } };
	}
	return from.offset < to.offset ? { anchor: from, focus: to } : { anchor: to, focus: from };
}

const focused = (): HTMLElement => (document.activeElement as HTMLElement | null) ?? document.body;

/** Drives `gesture`; false where jsdom has no engine for what the browser would do. */
async function drive(editor: Editor, gesture: Gesture): Promise<boolean> {
	if ('key' in gesture) await deleteBy(focused(), gesture.key);
	else if ('soft' in gesture) await softBackspace(focused());
	else if ('word' in gesture)
		return (await pressHardwareKey(focused(), { key: gesture.word, ctrlKey: true })) !== 'browser';
	else if ('enter' in gesture) {
		const shiftKey = gesture.enter === 'Shift+Enter';
		return (await pressHardwareKey(focused(), { key: 'Enter', shiftKey })) !== 'browser';
	} else if ('letter' in gesture) await insertBy(gesture.route, focused(), gesture.letter);
	else if ('paste' in gesture) await pasteGesture(editor, { 'text/plain': gesture.paste }, 'key');
	else await clipboardGesture(editor, 'cut', 'key');
	return true;
}

/** A place with no caret surface (a rule, a picture) or no character to take is no draw. */
const NO_DRAW = /no prose surface|no block mounted|out of range|no caret to insert|IndexSizeError/;

/** The gesture over `source`, then a letter: a step after each (a cut pasted back is two), or
 *  null where the draw names no place there or jsdom can't drive it. */
export async function stepsOver(source: string, draw: Draw): Promise<Step[] | null> {
	const editor = mountCase(source, draw.mode);
	try {
		await editor.settle();
		const selection = resolve(editor.instance.__test.getDocument(), draw.where);
		if (!selection) return null;
		const { anchor, focus } = selection;
		const collapsed = JSON.stringify(anchor) === JSON.stringify(focus);
		if (collapsed) placeCaret(surfaceAt(editor, anchor.path), anchor.offset);
		else if (draw.where.holder === 'editor') {
			if (!(await placeOwnedRange(editor, selection))) return null;
		} else if (!(await placeRange(editor, selection))) return null;
		await editor.settle();
		takeDevWarns();
		const step = async (name: string): Promise<Step> => {
			await editor.settle();
			const doc = editor.instance.__test.getDocument();
			const bytes = editor.source();
			const { getSelection, __test } = editor.instance;
			return {
				name,
				source: bytes,
				caret: JSON.stringify([getSelection(), __test.getGapCaret()]),
				warns: takeDevWarns().map((warn) => warn.tag),
				diverges: describeConvergence(doc, __test.getGrammar()),
				last: lastLineOf(doc)
			};
		};
		const steps: Step[] = [];
		const { gesture } = draw;
		if ('cut' in gesture && gesture.cut === 'then pasted back') {
			const payload = await clipboardGesture(editor, 'cut', 'key');
			steps.push(await step('the cut'));
			await pasteGesture(editor, payload, 'key');
			steps.push(await step('the paste back'));
		} else {
			if (!(await drive(editor, gesture))) return null;
			steps.push(await step('the gesture'));
		}
		await insertBy('hardware key', focused(), 'x');
		return [...steps, await step('the letter')];
	} catch (error) {
		if (NO_DRAW.test(String(error))) return null;
		throw error;
	} finally {
		await destroyMountedEditors();
		takeDevWarns();
	}
}

// ── The two readings of a run ────────────────────────────────────────────────

/** The bytes a file that stood `before` may hold where its twin holds `twin`: the twin's, less the
 *  final break unless the file had one or the line left last is blank. */
export function fromTwin(before: string, twin: Step): string[] {
	const ending = ownTrailingLineEnding(twin.source);
	if (ownTrailingLineEnding(before) || !ending) return [twin.source];
	const opened = twin.source.slice(0, -ending.length);
	// An emptied file has no last line, so it keeps a break or none.
	if (opened === '') return [twin.source, opened];
	// An empty paragraph on a marker line keeps the break, drops it, or gives up its line.
	if (twin.last === 'either') return [twin.source, opened, opened.replace(/\r?\n[ \t>]*$/, '')];
	return [twin.last === 'blank' ? twin.source : opened];
}

const q = (text: string) => JSON.stringify(text);

/** A line per way the open file's run departs from its twin's. */
export function twinLines(draw: Draw, openRun: Step[], twinRun: Step[]): string[] {
	const out: string[] = [];
	let before = draw.source;
	for (const [i, got] of openRun.entries()) {
		const twin = twinRun[i];
		const after = `after ${got.name}`;
		const want = fromTwin(before, twin);
		if (!want.includes(got.source)) {
			out.push(`${after} ${q(got.source)}, by its twin ${q(want[0])} (twin ${q(twin.source)})`);
			break;
		}
		if (got.caret !== twin.caret)
			out.push(`${after} the caret ${got.caret}, its twin’s ${twin.caret}`);
		const warned = got.warns.filter((tag) => !twin.warns.includes(tag));
		if (warned.length > 0) out.push(`${after} warned ${warned.join(', ')}, its twin did not`);
		// An emptied block on its container's marker line, or an emptied document, keeps an empty
		// paragraph no reload reads.
		const emptied = got.last === 'either' || got.source === '';
		if (got.diverges && !twin.diverges && !emptied)
			out.push(`${after} a reload reads ${got.diverges}`);
		// An emptied file has no last line, so what follows is no law of the last line's.
		if (isBlankText(got.source)) break;
		before = got.source;
	}
	return out;
}

/** A line per step that breaks the last line's own contract, read off the open file alone. */
export function keptLines(draw: Draw, openRun: Step[]): string[] {
	const out: string[] = [];
	let before = draw.source;
	for (const { name, source, last, warns } of openRun) {
		if (!ownTrailingLineEnding(before) && ownTrailingLineEnding(source) && last === 'text')
			out.push(`after ${name} ${q(source)} gained a final break on a written line`);
		if (warns.includes('invariant:last-line-kept'))
			out.push(`after ${name} the last-line guard warned`);
		before = source;
	}
	return out;
}

// ── The classes that depart today ────────────────────────────────────────────

const lastLine: Pick<Where, 'from' | 'to'> = {
	from: { back: 0, at: 'line start', inside: 0 },
	to: { back: 0, at: 'end', inside: 0 }
};
/** `gesture` over the whole last line of `source`'s last block. */
export const over = (
	source: string,
	holder: Where['holder'],
	gesture: Gesture,
	mode: Draw['mode']
): Draw => ({ source, mode, where: { ...lastLine, holder }, gesture });

const caretAt = (source: string, at: At, gesture: Gesture, mode: Draw['mode']): Draw => ({
	source,
	mode,
	where: { from: { back: 0, at, inside: 0 }, to: null, holder: 'browser' },
	gesture
});

/** Whether the editor holds the draw's range: a finger's in one block, or any across blocks. */
const editorHeld = ({ where }: Draw) =>
	!!where.to && (where.holder === 'editor' || where.from.back > 0);
const lastLineIn = (source: string) => source.slice(source.lastIndexOf('\n') + 1);
const removes = (gesture: Gesture) =>
	'key' in gesture || 'soft' in gesture || 'word' in gesture || 'cut' in gesture;
const QUOTE_LINE = /^[ \t]*>/m;
const LIST_LINE = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/m;
const CLOSING_FENCE = /^[ \t>]*(?:`{3,}|~{3,}|\${2}|:{3,})[ \t]*$/;

/** A class of draws that depart from the twin today: what is wrong, the draws it holds (wider is
 *  fine, a class holds no draw of a rule this suite pins elsewhere), and one that must still depart. */
interface Known {
	defect: string;
	holds(draw: Draw): boolean;
	repro: Draw;
}

export const KNOWN: Known[] = [
	{
		defect:
			'a letter over a range the editor holds is a removal, then the letter: the line the removal ' +
			'left blank kept its break, so the letter lands in a file that has one',
		holds: (draw) => editorHeld(draw) && 'letter' in draw.gesture,
		repro: over('above\npq', 'editor', { letter: 'x', route: 'hardware key' }, 'source')
	},
	{
		defect:
			'a paste of several lines, or over a range the editor holds, lands by the paste’s own ' +
			'open-end rule, which still adds a line (`syntax-tree.md` § The last line, “for now”)',
		holds: (draw) =>
			'paste' in draw.gesture && (editorHeld(draw) || draw.gesture.paste.includes('\n')),
		repro: over('above\npq', 'editor', { paste: 'line one\nline two\n' }, 'source')
	},
	{
		defect:
			'Enter or Shift+Enter over a range the editor holds takes its place from a removal the ' +
			'twin rule never reads: a quote’s marker respelled, a code body’s line lost with the caret',
		holds: (draw) => editorHeld(draw) && 'enter' in draw.gesture,
		repro: over('zz\n\n```js\none\npq', 'editor', { enter: 'Enter' }, 'live')
	},
	{
		defect:
			'a quote’s line emptied through a range the editor holds stays open on its marker, and ' +
			'the next letter opens a paragraph where the twin’s joins the line above; a file that ' +
			'ends on a bare marker reads another block than its twin, and Enter in a quote respells ' +
			'a marker above',
		holds: (draw) =>
			((editorHeld(draw) || 'enter' in draw.gesture) && QUOTE_LINE.test(draw.source)) ||
			/^[ \t>]*>[ \t]*$/.test(lastLineIn(draw.source)),
		repro: over('> above\n> pq', 'editor', { key: 'Delete' }, 'source')
	},
	{
		defect:
			'a list’s own edit (Enter in an item, a join at an item’s start) leaves a line of ' +
			'spaces, or respells an indent, where the twin leaves none',
		holds: ({ where, gesture, source }) =>
			('enter' in gesture || (!where.to && removes(gesture))) && LIST_LINE.test(source),
		repro: caretAt('1. a\n2. b', 'start', { enter: 'Enter' }, 'source')
	},
	{
		defect:
			'a closing fence line taken at an open end: the closer the block writes back stands on ' +
			'the emptied line, where the twin keeps that line above it',
		holds: (draw) => !editorHeld(draw) && CLOSING_FENCE.test(lastLineIn(draw.source)),
		repro: over('zz\n\n~~~\npq\n~~~', 'browser', { cut: 'key' }, 'source')
	},
	{
		defect:
			'a CRLF alert emptied to its title line is one line with no ending, so the next line it ' +
			'takes ends in LF',
		holds: ({ source }) =>
			source.includes('\r\n') && /(?:^|\n)[ \t]*> \[![^\n]*\n[^]*$/.test(source),
		repro: {
			source: '> [!NOTE]\r\n> a\r\n> pq',
			mode: 'source',
			where: {
				from: { back: 0, at: 'start', inside: 0 },
				to: { back: 0, at: 'end', inside: 0 },
				holder: 'browser'
			},
			gesture: { cut: 'key' }
		}
	},
	{
		defect: 'a live removal that leaves hidden delimiters alone reads back as no block (#841)',
		holds: ({ mode, where, gesture, source }) =>
			mode === 'live' &&
			!(where.to && where.holder === 'editor') &&
			removes(gesture) &&
			/[*_~`$]/.test(lastLineIn(source)),
		repro: {
			source: '~~s~~ t',
			mode: 'live',
			where: {
				from: { back: 0, at: 'inside', inside: 1 },
				to: { back: 0, at: 'end', inside: 0 },
				holder: 'browser'
			},
			gesture: { key: 'Delete' }
		}
	}
];
