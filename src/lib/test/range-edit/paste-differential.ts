// Today's paste against the range-edit core's, one case at a time: the mounted editor pastes
// through its own event routes, and the core answers the same bytes, range and clipboard, landed as
// the byte splice lands it (a closing line under an opener it writes included). Rows go out as data;
// nothing here decides which side is right.

import type { Document } from '#lib/core/nodes.js';
import type { SpliceCaret } from '#lib/action-contracts.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import type { GapCaretPosition } from '#lib/selection/gap-caret.js';
import type { Gesture, Held, Range, RangeEditResult } from '#lib/range-edit/edit-range.js';
import { editRange, wholeBlocksRemovalOf } from '#lib/range-edit/edit-range.js';
import { rangeHost, type Mode } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { normalizeCharEndpoint } from '#lib/selection/char-endpoint-snap.js';
import { pathsEqual } from '#lib/selection/path-math.js';
import { removalBytes, wholeBlockBytes } from '#lib/selection/range-bytes.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { serialize } from '#lib/core/serializer.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { changedBytes, changesBetween } from '#lib/tree-operations/byte-changes.js';
import {
	spliceReading,
	topLevelReading,
	type SpliceReading
} from '#lib/tree-operations/byte-splice.js';
import { splicedOpenerClosers, withSplicedClosers } from '#lib/tree-operations/spliced-openers.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { offsetPastClosers } from '#lib/tree-operations/written-openers.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { dispatchKey } from '#lib/test/harness/settle.js';
import {
	StubDataTransfer,
	dispatchClipboardEvent,
	systemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { visibleText } from '#lib/core/inline/link-source-bytes.js';
import { hidesDelimitersAtCaret } from '#lib/presentation-mode.js';
import { expectedPaste, plainPasteHolds, readOf } from './expected';
import { heldBy } from './laws';
import { noTransforms, type CheckHost } from './test-host';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeRange,
	Undetermined,
	type Editor,
	type PasteRoute
} from '../range-laws/gestures';
import { caretOf } from '../range-laws/through-splice';
import { landingAt } from '#lib/editor-actions/commit/byte-splice.js';
import { caretTargetFor } from '#lib/selection/caret-target.js';

/** How today's editor gets the paste: a route of its own, Ctrl+Shift+V, or a cut by its chord and
 *  then Ctrl+V (or the menu's plain paste) of what the cut wrote, at the caret it left. */
export type DiffRoute = PasteRoute | 'plain menu' | 'shift key' | 'cut then key' | 'cut then plain';

/** Where the paste arrives: a caret or range the editor holds, a block focused whole, the gap caret. */
export type Place = EditorSelection | { whole: number[] } | { gap: GapCaretPosition };

export interface PasteCase {
	name?: string;
	source: string;
	mode: Mode;
	via: Place;
	/** The clipboard's `text/plain`, its line endings as another app wrote them. */
	clip: string;
	route: DiffRoute;
}

export interface Answer {
	source: string;
	caret: SpliceCaret | null;
	/** Today's side: the selection and gap caret the editor holds after the paste. */
	held?: string;
}

export interface PasteRow extends PasteCase {
	/** The bytes the core was handed; null where the editor keeps the gesture (a cell rectangle). */
	range: Range | null;
	today: Answer | { undetermined: string };
	/** The core's answer as the byte splice lands it, and before, where a closer changed it. */
	core: Answer | { threw: string } | null;
	coreRaw?: Answer;
	/** A cut's paste back with the editor's own entry beside its text. */
	coreOwn?: Answer;
	/** For a cut first: the clipboard it wrote, and whether its bytes were the core's cut. */
	cut?: { clip: string; sameAsCore: boolean };
	/** Where the splice's window inside a container read other than the top-level window. */
	window?: string;
	/** The core's answer for the clipboard less its last line ending, where it has one. */
	coreNoTrail?: Answer;
	tags?: Tags;
	laws?: LawVerdicts;
	/** For a row whose bytes agree: whether the core's caret lands where today's does. */
	landsSame?: boolean;
	warns: string[];
	verdict: 'same' | 'bytes' | 'caret' | 'undetermined' | 'no core' | 'core threw';
}

const LF = (text: string) => text.replace(/\r\n?/g, '\n');
/** What the core is told the caret holds: a block focused whole and a gap are the boundary under
 *  them, between their parent's children. */
function heldAt(via: Place): Held {
	if ('whole' in via) return { holds: 'boundary', parent: via.whole.slice(0, -1) };
	return 'gap' in via ? { holds: 'boundary', parent: via.gap.parentPath } : { holds: 'text' };
}
const CUTS: readonly DiffRoute[] = ['cut then key', 'cut then plain'];

/** The editor's range as the core receives it, read as a removal reads it; a block focused whole
 *  or a gap is the byte of the boundary below it. Null for a rectangle of cells. */
export function bytesOf(doc: Document, place: Place): Range | null {
	const layout = documentLayout(measured(doc));
	if ('whole' in place || 'gap' in place) {
		const [parent, index] =
			'whole' in place
				? [place.whole.slice(0, -1), place.whole.at(-1)! + 1]
				: [place.gap.parentPath, place.gap.index];
		const at = layout.block([...parent, index])?.from ?? endOf(doc, layout, parent);
		return { from: at, to: at };
	}
	const { anchor, focus } = place;
	if (
		pathsEqual(anchor.path, focus.path) &&
		anchor.offset === focus.offset &&
		!anchor.cellCoordinate
	) {
		const at = layout.byteOf(anchor.path, anchor.offset);
		return at === null ? null : { from: at, to: at };
	}
	const snapped = (point: typeof anchor, other: typeof anchor) =>
		point.cellCoordinate || pathsEqual(point.path, other.path)
			? point
			: normalizeCharEndpoint(doc, point, other.path);
	const covered = coverRange(doc, snapped(anchor, focus), snapped(focus, anchor));
	return removalBytes(doc, rangeCoverage(doc, covered), layout);
}

function endOf(doc: Document, layout: ReturnType<typeof documentLayout>, parent: number[]): number {
	return parent.length === 0 ? serialize(doc).length : (layout.block(parent)?.to ?? 0);
}

/** The core's answer to `gesture` on `source`, as the editor's grammar reads it, and that answer
 *  once the byte splice writes the closers its changes need. */
export function coreAnswer(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	grammar: GrammarView
): { raw: RangeEditResult; landed: Answer; window?: string } {
	const reading = fixtureReading({ grammar }, mode);
	const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const laid = measured(doc);
	const layout = documentLayout(laid);
	const host = noTransforms(rangeHost(reading, { source, measured: laid, layout }));
	const raw = editRange(source, range, gesture, mode, host);
	const changes = changesBetween(source, raw.source);
	const read = spliceReading(measured(doc), source, changes, grammar);
	const closers = read ? splicedOpenerClosers(measured(doc), source, changes, read, grammar) : [];
	const made = withSplicedClosers(source, changes, closers);
	const written = changedBytes(source, 0, source.length, made);
	const caret = { ...raw.caret, at: offsetPastClosers(raw.caret.at, closers) };
	return { raw, landed: { source: written, caret }, window: windowParity(source, made, grammar) };
}

/** Why the splice's windows read `changes` other than the top-level window would; undefined when
 *  they read it the same. */
function windowParity(
	source: string,
	changes: ReturnType<typeof changesBetween>,
	grammar: GrammarView
) {
	const open = () => readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const [inside, outside] = [open(), open()];
	const install = (doc: Document, reading: SpliceReading | null) => {
		for (const w of [...(reading?.windows ?? [])].reverse())
			doc.children.splice(w.at, w.count, ...(w.blocks as Document['children']));
		if (reading) doc.suffix = reading.suffix;
	};
	const windows = spliceReading(measured(inside), source, changes, grammar)?.windows ?? [];
	if (!windows.some((w) => w.run)) return undefined;
	install(inside, spliceReading(measured(inside), source, changes, grammar));
	install(outside, topLevelReading(measured(outside), source, changes, grammar));
	const [a, b] = [serialize(inside), serialize(outside)];
	if (a !== b) return `bytes ${JSON.stringify(a)}, top level ${JSON.stringify(b)}`;
	return describeShapeDivergence(inside, outside) ?? undefined;
}

/** One case through today's editor and through the core, in a fresh mount. */
export async function diffCase(input: PasteCase): Promise<PasteRow> {
	const editor = mountCase(input.source, input.mode);
	const row: PasteRow = {
		...input,
		range: null,
		today: { undetermined: '' },
		core: null,
		warns: [],
		verdict: 'undetermined'
	};
	try {
		await editor.settle();
		takeDevWarns();
		const grammar = editor.instance.__test.getGrammar();
		const doc = editor.instance.__test.getDocument() as Document;
		const before = editor.source();
		row.range = bytesOf(doc, input.via);
		if (!(await place(editor, input.via))) {
			row.today = { undetermined: 'unplaceable' };
			return row;
		}
		row.today = await todayAnswer(editor, input, row);
		row.warns = takeDevWarns().map((w) => `${w.tag}: ${w.message}`);
		if (row.range) row.core = coreSide(before, row.range, input, grammar, row);
		row.tags = tagsOf(row, grammar);
		row.laws = lawsOf(row, grammar);
	} catch (error) {
		if (!(error instanceof Undetermined)) throw error;
		row.today = { undetermined: error.message };
	} finally {
		await editor.destroy();
		takeDevWarns();
	}
	row.verdict = verdictOf(row);
	if (row.verdict === 'caret') row.landsSame = await landsSame(row);
	return row;
}

const heldOf = (editor: Editor) =>
	JSON.stringify([editor.instance.getSelection(), editor.instance.__test.getGapCaret()]);

/** Whether the core's caret, put down by the byte splice's landing in a fresh editor over today's
 *  bytes, is where today's paste left its caret. */
async function landsSame(row: PasteRow): Promise<boolean> {
	const today = row.today as Answer & { held?: string };
	const caret = (row.core as Answer).caret;
	if (!caret) return false;
	const fresh = mountCase(today.source, row.mode);
	try {
		await fresh.settle();
		const landing = landingAt(measured(fresh.instance.__test.getDocument()), caret);
		if (!landing) return false;
		if ('anchor' in landing) await fresh.instance.setSelection(landing).catch(() => false);
		else if (!('gapCaret' in landing)) {
			const target = caretTargetFor(fresh.instance.__test.getDocument(), landing);
			if (target)
				fresh.instance.__test.getBlockComponent([...target.leafPath])?.focus(target.offset);
		}
		await fresh.settle();
		return heldOf(fresh) === today.held;
	} finally {
		await fresh.destroy();
		takeDevWarns();
	}
}

/** Puts the editor's selection at `via`: a block focused whole, the gap caret by the arrow that
 *  stops at it, or a caret or range. */
async function place(editor: Editor, via: Place): Promise<boolean> {
	if ('whole' in via) {
		editor.instance.__test.getBlockComponent(via.whole)?.focus(0);
		await editor.settle();
		return document.activeElement !== document.body;
	}
	if (!('gap' in via)) return (await placeRange(editor, via)) || placeByBlock(editor, via);
	const { parentPath, index } = via.gap;
	const reached = () =>
		JSON.stringify(editor.instance.__test.getGapCaret()) === JSON.stringify(via.gap);
	for (const [at, key] of [
		[index, 'ArrowUp'],
		[index - 1, 'ArrowDown'],
		[index, 'ArrowLeft'],
		[index - 1, 'ArrowRight']
	] as const) {
		const block = at >= 0 && editor.instance.__test.getBlockComponent([...parentPath, at]);
		if (!block) continue;
		block.focus(key === 'ArrowUp' || key === 'ArrowLeft' ? 0 : Number.MAX_SAFE_INTEGER);
		await editor.settle();
		await pressHardwareKey(document.activeElement as HTMLElement, { key });
		await editor.settle();
		if (reached()) return true;
	}
	return false;
}

/** A caret or range in a block whose text the native range can't reach in jsdom (a cell, a math
 *  block's source): the block's own focus, then the editor's selection call. */
async function placeByBlock(editor: Editor, via: EditorSelection): Promise<boolean> {
	editor.instance.__test.getBlockComponent(via.anchor.path)?.focus(via.anchor.offset);
	await editor.settle();
	if (via.anchor.offset !== via.focus.offset || !pathsEqual(via.anchor.path, via.focus.path)) {
		await editor.instance.setSelection(via).catch(() => false);
		await editor.settle();
	}
	return JSON.stringify(editor.instance.getSelection()) === JSON.stringify(via);
}

async function todayAnswer(editor: Editor, input: PasteCase, row: PasteRow): Promise<Answer> {
	if (CUTS.includes(input.route)) {
		const written = await clipboardGesture(editor, 'cut', 'key');
		const clip = written['text/plain'] ?? '';
		row.cut = { clip, sameAsCore: true };
		row.clip = clip;
		const cutSource = editor.source();
		if (row.range) {
			const grammar = editor.instance.__test.getGrammar();
			const cut = coreAnswer(row.source, row.range, 'cut', input.mode, grammar);
			row.cut.sameAsCore = cut.landed.source === cutSource && cut.raw.clipboard === clip;
		}
		if (input.route === 'cut then plain') await pastePlainGesture(editor, clip);
		else await pasteGesture(editor, { 'text/plain': clip }, 'key');
	} else if (input.route === 'plain menu') await pastePlainGesture(editor, input.clip);
	else if (input.route === 'shift key') await shiftPaste(editor, input.clip);
	else if ('whole' in input.via || 'gap' in input.via) {
		// A block focused whole and the gap caret hold no text, so the chord is the only route in.
		const at = document.activeElement as HTMLElement;
		if (!dispatchKey(at, { key: 'v', ctrlKey: true }).defaultPrevented)
			dispatchClipboardEvent(at, 'paste', new StubDataTransfer({ 'text/plain': input.clip }));
		await editor.settle();
		await editor.settle();
	} else await pasteGesture(editor, { 'text/plain': input.clip }, input.route as PasteRoute);
	return { source: editor.source(), caret: caretOf(editor), held: heldOf(editor) };
}

/** Ctrl+Shift+V: the browser sends the paste event `text/plain` alone. */
async function shiftPaste(editor: Editor, clip: string): Promise<void> {
	systemClipboard.clear();
	systemClipboard.set('text/plain', clip);
	const at = (document.activeElement as HTMLElement | null) ?? document.body;
	if (dispatchKey(at, { key: 'V', ctrlKey: true, shiftKey: true }).defaultPrevented)
		return editor.settle();
	dispatchClipboardEvent(at, 'paste', new StubDataTransfer({ 'text/plain': clip }));
	await editor.settle();
}

function coreSide(
	source: string,
	range: Range,
	input: PasteCase,
	grammar: GrammarView,
	row: PasteRow
): Answer | { threw: string } {
	const held = heldAt(input.via);
	try {
		let answer: ReturnType<typeof coreAnswer>;
		if (CUTS.includes(input.route)) {
			const cut =
				'whole' in input.via
					? wholeCut(source, input.via.whole, input.mode, grammar, row.cut?.clip ?? '')
					: coreAnswer(source, range, 'cut', input.mode, grammar);
			const at = { from: cut.raw.caret.at, to: cut.raw.caret.at };
			const text = LF(cut.raw.clipboard ?? '');
			const plain = input.route === 'cut then plain';
			const left = heldBy(cut.raw.caret);
			answer = coreAnswer(cut.raw.source, at, { paste: text, plain, ...left }, input.mode, grammar);
			const own = { paste: text, plain, ...left, own: cut.raw.own };
			row.coreOwn = coreAnswer(cut.raw.source, at, own, input.mode, grammar).landed;
		} else {
			const plain = input.route === 'plain menu' || input.route === 'shift key';
			answer = coreAnswer(
				source,
				range,
				{ paste: LF(input.clip), plain, ...held },
				input.mode,
				grammar
			);
		}
		if (answer.raw.source !== answer.landed.source) row.coreRaw = answer.raw;
		if (answer.window) row.window = answer.window;
		const clip = LF(row.clip);
		if (!CUTS.includes(input.route) && clip.endsWith('\n')) {
			const plain = input.route === 'plain menu' || input.route === 'shift key';
			const gesture = { paste: clip.slice(0, -1), plain, ...held };
			row.coreNoTrail = coreAnswer(source, range, gesture, input.mode, grammar).landed;
		}
		return answer.landed;
	} catch (error) {
		return { threw: (error as Error).message };
	}
}

/** What a row's shape is, for grouping rows by cause: where the paste lands and what it brings. */
export interface Tags {
	place: 'caret' | 'range in a block' | 'range across blocks' | 'cells' | 'whole' | 'gap';
	/** The text block at the range's start and the containers around it, outermost first. */
	kind: string;
	inside: string;
	/** Whether visible text stands before and after the range on its line. */
	before: boolean;
	after: boolean;
	/** The clipboard's top-level kinds, blank paragraphs left out. */
	clip: string[];
	lines: number;
	crlf: boolean;
}

export function tagsOf(row: PasteRow, grammar: GrammarView): Tags | undefined {
	const { range, via } = row;
	if (!range) return undefined;
	const doc = readAsOpened(row.source, { grammar, scope: 'document' }) as Document;
	const layout = documentLayout(measured(doc));
	const point = layout.pointAt(range.from);
	const path = point?.path ?? [];
	const kinds: string[] = [];
	let nodes: readonly { kind: string; children?: unknown[] }[] = doc.children;
	for (const i of path) {
		const node = nodes[i];
		if (!node) break;
		kinds.push(node.kind);
		nodes = (node.children ?? []) as typeof nodes;
	}
	const text = point ? layout.block(path)?.text : undefined;
	const { source } = row;
	const lineStart = Math.max(source.lastIndexOf('\n', range.from - 1) + 1, text?.from ?? 0);
	const breakAt = source.indexOf('\n', range.to);
	const lineEnd = Math.min(breakAt < 0 ? source.length : breakAt, text?.to ?? source.length);
	const clip = readAsOpened(LF(row.clip), { grammar, scope: 'document' }).children;
	const place: Tags['place'] =
		'whole' in via
			? 'whole'
			: 'gap' in via
				? 'gap'
				: via.anchor.cellCoordinate || via.focus.cellCoordinate
					? 'cells'
					: range.from === range.to
						? 'caret'
						: pathsEqual(via.anchor.path, via.focus.path)
							? 'range in a block'
							: 'range across blocks';
	return {
		place,
		kind: kinds.at(-1) ?? 'none',
		inside: kinds.slice(0, -1).join('>'),
		before: source.slice(lineStart, range.from).trim() !== '',
		after: source.slice(range.to, lineEnd).trim() !== '',
		clip: clip.filter((b) => b.raw.trim() !== '').map((b) => b.kind),
		lines: LF(row.clip).split('\n').length,
		crlf: source.includes('\r\n')
	};
}

/** Law 9 (a paste at a caret) or law 11 (a plain one) asked of each side's bytes: true where the
 *  side keeps it, undefined where the law decides nothing there. */
export interface LawVerdicts {
	law: 'L9' | 'L11';
	shape?: string;
	today?: boolean;
	core?: boolean;
}

export function lawsOf(row: PasteRow, grammar: GrammarView): LawVerdicts | undefined {
	const { range } = row;
	if (!range || range.from !== range.to || CUTS.includes(row.route)) return undefined;
	const reading = fixtureReading({ grammar }, row.mode);
	const shows = (text: string, mode: Mode) =>
		visibleText(text, {
			...reading,
			mode: () => mode,
			hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(mode)
		});
	const host: CheckHost = { ...noTransforms(rangeHost(reading)), shows };
	const read = readOf(host, row.source);
	const text = LF(row.clip);
	const bytes = (side: PasteRow['today'] | PasteRow['core']) =>
		side && 'source' in side ? side.source : undefined;
	const [today, core] = [bytes(row.today), bytes(row.core)];
	if (row.route === 'plain menu' || row.route === 'shift key') {
		const holds = (got?: string) =>
			got === undefined ? undefined : plainPasteHolds(read, range.from, text, got, host, row.mode);
		return { law: 'L11', today: holds(today), core: holds(core) };
	}
	const want = expectedPaste(read, range.from, text, host, heldAt(row.via));
	if (want.shape === 'other') return { law: 'L9', shape: 'other' };
	const holds = (got?: string) => (got === undefined ? undefined : want.bytes.includes(got));
	return { law: 'L9', shape: want.shape, today: holds(today), core: holds(core) };
}

/** A block focused whole cut by its chord: the core's whole-block removal, and the block's text the
 *  chord wrote. */
function wholeCut(source: string, path: number[], mode: Mode, grammar: GrammarView, clip: string) {
	const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const laid = measured(doc);
	const layout = documentLayout(laid);
	const host = rangeHost(fixtureReading({ grammar }, mode), { source, measured: laid, layout });
	const range = wholeBlockBytes(doc, layout, path)!;
	return { raw: { ...wholeBlocksRemovalOf(source, range, 'cut', mode, host), clipboard: clip } };
}

function verdictOf(row: PasteRow): PasteRow['verdict'] {
	if ('undetermined' in row.today) return 'undetermined';
	if (!row.core) return 'no core';
	if ('threw' in row.core) return 'core threw';
	if (row.today.source !== row.core.source) return 'bytes';
	const [a, b] = [row.today.caret, row.core.caret];
	return a?.at === b?.at && a?.holds === b?.holds ? 'same' : 'caret';
}
