// The range-edit laws (the laws file of the 2026-11-05 audit), each a run through the mounted
// editor that returns its violations as lines: `L<law>[.<label>] [<shape>] <gesture> <mode>/<eol>:
// <what differed>`. A run that can't decide (a range that won't place, a key only a browser would
// act on) returns an `undetermined` line instead, which neither passes nor fails.

import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { parse, serialize, getContentRange } from '#lib/index.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangePaint } from '#lib/selection/range-bytes.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { visibleText } from '#lib/core/inline/link-source-bytes.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	clipboardGesture,
	deleteGesture,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeRange,
	runHistory,
	typeGesture,
	type ClipboardRoute,
	type Editor,
	type Payload,
	type PasteRoute,
	type TypedKey,
	Undetermined
} from './gestures';
import { bodyOf, bytePositions, opened, pointKey } from './positions';
import { resolveCaret, resolveRange, shapeOf, type EndSeed, type RangeSeed } from './ranges';
import { endingOf } from './shapes';

export interface LawInput {
	source: string;
	mode: PresentationMode;
	seed: RangeSeed;
}

/** A gesture at a caret rather than over a range. */
export type CaretInput = Omit<LawInput, 'seed'> & { caret: EndSeed };

export interface LawRun {
	/** Violations, one line each. */
	lines: string[];
	/** Why the run couldn't decide, one line each. */
	undetermined: string[];
	/** Declared exceptions the run landed in, by name. */
	declared: string[];
	/** The range or caret the run placed, for a report's counterexample. */
	range?: EditorSelection;
}

const quote = (text: string) => JSON.stringify(text);

/** One mount of `input`, its range placed, and how to write a line about it. */
interface Opened {
	editor: Editor;
	range: EditorSelection;
	line(law: string, gesture: string, detail: string): string;
}

async function open(
	input: LawInput,
	run: LawRun,
	pick: (doc: Document) => EditorSelection | null = (doc) => resolveRange(doc, input.seed)
): Promise<Opened | null> {
	const editor = mountCase(input.source, input.mode);
	await editor.settle();
	// What a document fires as it opens is the open's business, not a range edit's.
	takeDevWarns();
	const doc = editor.instance.__test.getDocument();
	const range = pick(doc);
	if (!range) {
		run.undetermined.push('no range to draw');
		return null;
	}
	if (!(await placeRange(editor, range))) {
		run.undetermined.push(`unplaceable ${JSON.stringify(range)}`);
		return null;
	}
	run.range = range;
	const tag = `[${shapeOf(doc, range)}]`;
	const modeTag = `${input.mode}/${endingOf(input.source)}`;
	return {
		editor,
		range,
		line: (law, gesture, detail) => `${law} ${tag} ${gesture} ${modeTag}: ${detail}`
	};
}

const emptyRun = (): LawRun => ({ lines: [], undetermined: [], declared: [] });

async function destroy(...editors: (Opened | null)[]) {
	for (const opened of editors) await opened?.editor.destroy();
}

/** `error` recorded as undetermined when a gesture couldn't be driven; anything else rethrown. */
function undecided(run: LawRun, error: unknown): void {
	if (!(error instanceof Undetermined)) throw error;
	run.undetermined.push(error.message);
}

// ── Post-conditions every mutating gesture keeps ─────────────────────────────

/** Law 8: the tree is a reload of its bytes, which round-trip, and no dev check fired. */
function law8(at: Opened, gesture: string, run: LawRun): void {
	const source = at.editor.source();
	const doc = at.editor.instance.__test.getDocument();
	const diverged = source === '' ? null : reloadDivergence(doc, source);
	if (diverged)
		run.lines.push(at.line('L8', gesture, `${quote(source)} differs from a reload: ${diverged}`));
	if (serialize(parse(source)) !== source) {
		run.lines.push(at.line('L8', gesture, `${quote(source)} does not round-trip`));
	}
	for (const tag of new Set(takeDevWarns().map((record) => record.tag))) {
		run.lines.push(at.line('L8', gesture, `fired ${tag}`));
	}
}

/** Law 7: one undo gives back `before` and one redo the bytes after; a paste's undo also puts
 *  the caret back where it began, read off the entry undo restores (jsdom's restore never lands). */
async function law7(
	at: Opened,
	gesture: string,
	before: { source: string; selection: EditorSelection | null },
	run: LawRun,
	caret: boolean
): Promise<void> {
	const after = at.editor.source();
	if (after === before.source) return;
	const restores = at.editor.instance.__test.getUndoStack().undo.at(-1)?.selection;
	await runHistory(at.editor, 'undo');
	const undone = at.editor.source();
	if (undone !== before.source) {
		run.lines.push(
			at.line('L7', gesture, `undo gave ${quote(undone)}, not ${quote(before.source)}`)
		);
	} else if (caret && before.selection && !caretBackAtStart(restores, before.selection)) {
		const at_ = JSON.stringify(restores ?? null);
		run.lines.push(
			at.line('L7.caret', gesture, `undo restores ${at_}, not ${JSON.stringify(before.selection)}`)
		);
	}
	takeDevWarns();
	await runHistory(at.editor, 'redo');
	const redone = at.editor.source();
	if (redone !== after)
		run.lines.push(at.line('L7', gesture, `redo gave ${quote(redone)}, not ${quote(after)}`));
	takeDevWarns();
}

/** The selection the gesture began with, or a caret at its start. */
function caretBackAtStart(now: unknown, began: EditorSelection): boolean {
	if (!isRange(now)) return false;
	if (JSON.stringify(now) === JSON.stringify(began)) return true;
	const start = startOf(began);
	return (
		JSON.stringify(now.anchor) === JSON.stringify(start) &&
		JSON.stringify(now.focus) === JSON.stringify(start)
	);
}

const isRange = (s: unknown): s is EditorSelection =>
	!!s && typeof s === 'object' && 'anchor' in s && 'focus' in s;

function startOf({ anchor, focus }: EditorSelection): SelectionPoint {
	const a = anchor.path;
	const b = focus.path;
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? anchor : focus;
	}
	if (a.length !== b.length) return a.length < b.length ? anchor : focus;
	return anchor.offset <= focus.offset ? anchor : focus;
}

const snapshot = (at: Opened) => ({
	source: at.editor.source(),
	selection: at.editor.instance.getSelection(),
	undo: at.editor.instance.__test.getUndoStack().undo.length
});

// ── Laws 1 and 2: copy ───────────────────────────────────────────────────────

/** Law 1: a copy and a cut of the same range write the same clipboard, by any two routes. */
export async function law1(
	input: LawInput,
	copy: ClipboardRoute,
	cut: ClipboardRoute
): Promise<LawRun> {
	const run = emptyRun();
	const at = await open(input, run);
	if (!at) return run;
	try {
		const copied = await clipboardGesture(at.editor, 'copy', copy);
		takeDevWarns();
		await placeRange(at.editor, at.range);
		const before = snapshot(at);
		const gesture = `copy:${copy} cut:${cut}`;
		const cutPayload = await clipboardGesture(at.editor, 'cut', cut);
		if (JSON.stringify(copied) !== JSON.stringify(cutPayload)) {
			run.lines.push(
				at.line(
					'L1',
					gesture,
					`copy wrote ${JSON.stringify(copied)}, cut ${JSON.stringify(cutPayload)}`
				)
			);
		}
		law8(at, `cut:${cut}`, run);
		await law7(at, `cut:${cut}`, before, run, false);
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

/** Law 2: a copy leaves the bytes, the selection and the undo stack as they were. */
export async function law2(input: LawInput, copy: ClipboardRoute): Promise<LawRun> {
	const run = emptyRun();
	const at = await open(input, run);
	if (!at) return run;
	try {
		const before = snapshot(at);
		await clipboardGesture(at.editor, 'copy', copy);
		const after = snapshot(at);
		for (const field of ['source', 'selection', 'undo'] as const) {
			if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
				run.lines.push(
					at.line(
						'L2',
						`copy:${copy}`,
						`${field} was ${JSON.stringify(before[field])}, is ${JSON.stringify(after[field])}`
					)
				);
			}
		}
		for (const tag of new Set(takeDevWarns().map((record) => record.tag))) {
			run.lines.push(at.line('L8', `copy:${copy}`, `fired ${tag}`));
		}
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

// ── Law 3: cut, then paste back ──────────────────────────────────────────────

/** Law 3: a cut, then a paste of what it wrote at the caret it left, gives the bytes back. */
export async function law3(
	input: LawInput,
	cut: ClipboardRoute,
	paste: PasteRoute
): Promise<LawRun> {
	const run = emptyRun();
	const at = await open(input, run);
	if (!at) return run;
	try {
		const original = at.editor.source();
		const payload = await clipboardGesture(at.editor, 'cut', cut);
		law8(at, `cut:${cut}`, run);
		// A cut that left its range selected would have the paste replace it, giving the bytes back
		// whether or not anything was cut.
		const left = at.editor.instance.getSelection();
		if (left && keyOf(left.anchor) !== keyOf(left.focus)) {
			const span = `${keyOf(left.anchor)} to ${keyOf(left.focus)}`;
			run.lines.push(at.line('L3', `cut:${cut}`, `left the range ${span} selected, not a caret`));
			return run;
		}
		const before = snapshot(at);
		const gesture = `cut:${cut} paste:${paste}`;
		await pasteGesture(at.editor, payload, paste);
		law8(at, `paste:${paste}`, run);
		const restored = at.editor.source();
		if (restored !== original) {
			// Pasted lines take the document's first line ending (the paste pipeline's byte rule 3).
			if (endingOf(original) === 'mixed' && lf(restored) === lf(original))
				run.declared.push('L3 mixed line endings');
			else
				run.lines.push(at.line('L3', gesture, `gave ${quote(restored)}, not ${quote(original)}`));
		}
		await law7(at, `paste:${paste}`, before, run, true);
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

const lf = (text: string) => text.replace(/\r\n/g, '\n');

const keyOf = (point: SelectionPoint) => pointKey(point.path, point.offset);

// ── Law 4: Backspace and Delete are the cut's delete ─────────────────────────

/** Law 4: Backspace or Delete over a range leaves the bytes a cut of it leaves. */
export async function law4(input: LawInput, key: 'Backspace' | 'Delete'): Promise<LawRun> {
	const run = emptyRun();
	const cut = await open(input, run);
	if (!cut) return run;
	let keyed: Opened | null = null;
	try {
		await clipboardGesture(cut.editor, 'cut', 'key');
		takeDevWarns();
		const leftByCut = cut.editor.source();
		keyed = await open(input, run);
		if (!keyed) return run;
		const before = snapshot(keyed);
		if (!(await deleteGesture(keyed.editor, key))) {
			run.undetermined.push(`${key} was left to the browser`);
			return run;
		}
		const left = keyed.editor.source();
		if (left !== leftByCut) {
			// A key that changed nothing is its own shape, apart from one that removed the wrong bytes.
			const law = left === before.source ? 'L4.unchanged' : 'L4';
			run.lines.push(keyed.line(law, key, `left ${quote(left)}, the cut ${quote(leftByCut)}`));
		}
		law8(keyed, key, run);
		await law7(keyed, key, before, run, false);
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(cut, keyed);
	}
	return run;
}

// ── Law 5: typing and pasting over a range ───────────────────────────────────

/** What goes in over the range: a key typed, or a clipboard pasted. */
export type Replacement = { typed: TypedKey } | { pasted: string; route: PasteRoute };

const replacementName = (r: Replacement) =>
	'typed' in r ? ('key' in r.typed ? 'type:Enter' : `type:${r.typed.route}`) : `paste:${r.route}`;

async function replace(editor: Editor, r: Replacement): Promise<boolean> {
	if ('typed' in r) return typeGesture(editor, r.typed);
	await pasteGesture(editor, { 'text/plain': r.pasted }, r.route);
	return true;
}

/** Law 5: typing or pasting over a range leaves what a cut, then that key or paste at the caret
 *  the cut left, leaves; save the shapes `docs/design/selection.md` § Cross-block selection declares. */
export async function law5(input: LawInput, r: Replacement): Promise<LawRun> {
	const run = emptyRun();
	const over = await open(input, run);
	if (!over) return run;
	let cut: Opened | null = null;
	const gesture = replacementName(r);
	try {
		const before = snapshot(over);
		if (!(await replace(over.editor, r))) {
			run.undetermined.push(`${gesture} was left to the browser`);
			return run;
		}
		const replaced = over.editor.source();
		law8(over, gesture, run);
		await law7(over, gesture, before, run, 'pasted' in r);
		cut = await open(input, run);
		if (!cut) return run;
		await clipboardGesture(cut.editor, 'cut', 'key');
		takeDevWarns();
		const landing = cut.editor.instance.getSelection();
		if (!(await replace(cut.editor, r))) return run;
		takeDevWarns();
		const expected = cut.editor.source();
		if (replaced === expected) return run;
		const declared = law5Exception(input, over.range, landing, r, replaced);
		if (declared === null) {
			run.lines.push(
				over.line('L5', gesture, `gave ${quote(replaced)}, cut then ${gesture} ${quote(expected)}`)
			);
		} else if (declared.holds) run.declared.push(declared.name);
		else run.lines.push(over.line(`L5.${declared.name}`, gesture, `gave ${quote(replaced)}`));
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(over, cut);
	}
	return run;
}

/** The shapes `docs/design/selection.md` § Cross-block selection ("Replacing it") replaces other than by a cut
 *  then the key, and whether `replaced` is what its sentence says. Null when none applies. */
function law5Exception(
	input: LawInput,
	range: EditorSelection,
	landing: EditorSelection | null,
	r: Replacement,
	replaced: string
): { name: string; holds: boolean } | null {
	const doc = parse(input.source);
	const inOneTable =
		range.anchor.cellCoordinate &&
		range.focus.cellCoordinate &&
		range.anchor.path.join() === range.focus.path.join();
	const text = 'typed' in r ? ('text' in r.typed ? r.typed.text : null) : r.pasted;
	const composed = 'typed' in r && 'route' in r.typed && r.typed.route === 'composition';
	if (inOneTable && text !== null) {
		// Cells cleared and the text in the first; an IME clears them as a plain delete does.
		const tables = (source: string) =>
			parse(source).children.filter((n) => n.kind === 'table').length;
		const keptTable = tables(replaced) === tables(input.source);
		return {
			name: composed ? 'ime-in-cells' : 'text-in-first-cell',
			holds: keptTable && (composed || replaced.includes(text))
		};
	}
	if (text === null) return null;
	const cover = coverRange(doc, range.anchor, range.focus);
	const tookStart = cover.unitHolding(startOf(range).path) !== null;
	if (!tookStart) return null;
	const onSyntax = !landing || caretOnSyntax(parse(lf(input.source)), landing.anchor);
	const name = onSyntax ? 'emptied-paragraph' : 'whole-block-slot';
	// The text goes into a paragraph of its own where the range was.
	const own = parse(replaced).children.some(
		(n) => n.kind === 'paragraph' && n.raw.trim() === text.trim()
	);
	return { name, holds: own };
}

/** Whether `point` sits on a block's syntax rather than its text. */
function caretOnSyntax(doc: Document, point: SelectionPoint): boolean {
	const leaf = leafAt(doc, point.path);
	if (!leaf || leaf.children) return true;
	const { start, end } = getContentRange(leaf);
	return point.offset < start || point.offset > end || (start === end && leaf.kind !== 'paragraph');
}

function leafAt(doc: Document, path: readonly number[]): CstNode | null {
	let nodes: readonly CstNode[] = doc.children;
	let node: CstNode | null = null;
	for (const index of path) {
		node = nodes[index] ?? null;
		if (!node) return null;
		nodes = node.children ?? [];
	}
	return node;
}

// ── Law 9: a paste inserts its bytes at the caret ────────────────────────────

/** Law 9: a paste at a caret inserts its bytes at the caret's raw offset, the container's prefix
 *  at each line break, and joins its first and last block to the text either side. */
export async function law9(
	input: Omit<LawInput, 'seed'> & { caret: EndSeed },
	text: string,
	paste: PasteRoute
): Promise<LawRun> {
	const run = emptyRun();
	const at = await open({ ...input, seed: { a: input.caret, b: input.caret } }, run, (doc) =>
		resolveCaret(doc, input.caret)
	);
	if (!at) return run;
	const blocks = parse(text).children.filter((n) => n.kind !== 'paragraph' || n.raw.trim() !== '');
	const gesture = `paste:${paste} ${blocks.length === 1 && blocks[0].kind === 'paragraph' ? 'text' : 'blocks'}`;
	try {
		const source = at.editor.source();
		const caret = at.editor.instance.getSelection()!.anchor;
		const grammar = at.editor.instance.__test.getGrammar();
		const positions = bytePositions(source, grammar);
		const byte = positions.get(pointKey(caret.path, caret.offset));
		if (byte === undefined) {
			run.undetermined.push(`no byte for the caret ${pointKey(caret.path, caret.offset)}`);
			return run;
		}
		const raw = leafAt(at.editor.instance.__test.getDocument(), caret.path)?.raw ?? '';
		const prefix = prefixAt(source, byte, caret.offset, raw);
		const expected = splicedAt(source, byte, text, prefix);
		const declaredEnd = text.endsWith('\n')
			? splicedAt(source, byte, text.slice(0, -1), prefix)
			: null;
		const before = snapshot(at);
		await pasteGesture(at.editor, { 'text/plain': text }, paste);
		law8(at, `paste:${paste}`, run);
		const pasted = at.editor.source();
		// A pasted line's own line ending is dropped where nothing visible follows it.
		const wanted = [
			expected,
			...(declaredEnd !== null && nothingVisibleAfter(source, byte) ? [declaredEnd] : [])
		];
		if (pasted === expected) {
			// pass
		} else if (wanted.includes(pasted)) {
			run.declared.push('L9 trailing line ending dropped');
		} else {
			const respelled = wanted.find((w) => prefixRespelledAt(pasted, w, lineOf(source, byte)));
			const law = respelled === undefined ? 'L9' : 'L9.prefix';
			run.lines.push(
				at.line(law, gesture, `gave ${quote(pasted)}, not ${quote(respelled ?? expected)}`)
			);
		}
		await law7(at, `paste:${paste}`, before, run, true);
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

function splicedAt(source: string, byte: number, text: string, prefix: string): string {
	// Pasted lines take the document's first line ending (the paste pipeline's byte rule 3).
	const eol = /\r?\n/.exec(source)?.[0] ?? '\n';
	const lines = text.split('\n');
	// The caret's own text after it goes on the last pasted line, so that line keeps its prefix.
	const textAfter = !nothingVisibleAfter(source, byte);
	const written = lines
		.map((line, i) => {
			if (i === 0) return line;
			const blank = line === '' && !(i === lines.length - 1 && textAfter);
			return (blank ? prefix.trimEnd() : prefix) + line;
		})
		.join(eol);
	return source.slice(0, byte) + written + source.slice(byte);
}

/** The bytes a continuation line of the caret's block starts with: what its containers put before
 *  the block's bytes on the caret's line, a list marker (and its task box) read as spaces. */
function prefixAt(source: string, byte: number, offset: number, raw: string): string {
	const lineStart = source.lastIndexOf('\n', byte - 1) + 1;
	const ownBytes = offset - (raw.lastIndexOf('\n', offset - 1) + 1);
	return (
		source
			.slice(lineStart, byte - ownBytes)
			.replace(
				/(^|[\s>])([-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t])/g,
				(_, lead: string, marker: string) => lead + ' '.repeat(marker.length)
			)
			// A footnote definition's body goes four columns in, whatever its label's width.
			.replace(/^[ \t]*\[\^[^\]]*\]:[ \t]?/, '    ')
	);
}

function nothingVisibleAfter(source: string, byte: number): boolean {
	const lineEnd = source.indexOf('\n', byte);
	return source.slice(byte, lineEnd < 0 ? undefined : lineEnd).trim() === '';
}

const lineOf = (source: string, byte: number) => source.slice(0, byte).split('\n').length - 1;

/** Whether `got` is `wanted` with line prefixes spelled another way: each line keeps its text and
 *  its quote depth, and only line `at`, the one the paste lands on, may lose or gain a prefix whole. */
function prefixRespelledAt(got: string, wanted: string, at: number): boolean {
	const gotLines = got.split('\n');
	const wantedLines = wanted.split('\n');
	return (
		gotLines.length === wantedLines.length &&
		gotLines.every((line, i) => {
			const [a, b] = [splitPrefix(line), splitPrefix(wantedLines[i])];
			return (
				a.text === b.text &&
				quoteDepth(a.prefix) === quoteDepth(b.prefix) &&
				(i === at || (a.prefix === '') === (b.prefix === ''))
			);
		})
	);
}

const splitPrefix = (line: string) => {
	const prefix = /^[ \t>]*/.exec(line)![0];
	return { prefix, text: line.slice(prefix.length) };
};

const quoteDepth = (prefix: string) => prefix.replace(/[^>]/g, '').length;

// ── Law 10: container markers travel with their lines ────────────────────────

/** Law 10: a copy holds the lines it covers, the markers of every container it enters or leaves
 *  on them, and none of a container it stays inside. */
export async function law10(input: LawInput, copy: ClipboardRoute): Promise<LawRun> {
	const run = emptyRun();
	const at = await open(input, run);
	if (!at) return run;
	try {
		const grammar = at.editor.instance.__test.getGrammar();
		const tree = opened(at.editor.source(), grammar);
		const { anchor, focus } = at.range;
		const covered = coverRange(tree, anchor, focus);
		const start = startOf(at.range);
		const end = start === anchor ? focus : anchor;
		if (
			JSON.stringify(covered.start) !== JSON.stringify(start) ||
			JSON.stringify(covered.end) !== JSON.stringify(end)
		) {
			run.undetermined.push('L10 range snapped by coverage');
			return run;
		}
		if (start.cellCoordinate || end.cellCoordinate) {
			run.undetermined.push('L10 cell endpoint');
			return run;
		}
		const depth = commonDepth(start.path, end.path);
		const holder = depth === 0 ? tree : leafAt(tree, start.path.slice(0, depth))!;
		const body = bodyOf(holder);
		const positions = bytePositions(body, grammar);
		const from = positions.get(pointKey(start.path.slice(depth), start.offset));
		const to = positions.get(pointKey(end.path.slice(depth), end.offset));
		if (from === undefined || to === undefined) {
			run.undetermined.push('L10 an endpoint has no byte in its container body');
			return run;
		}
		const expected = body.slice(from, to);
		// A block or container the range holds whole is copied whole (`docs/design/selection.md` § Clipboard), so
		// an end at its edge reads by the coverage rule, which the laws leave open there.
		const paint = rangePaint(tree, rangeCoverage(tree, covered), documentLayout(tree));
		const atEdge = [start.path, end.path].some((p) => paint.boxHolding(p) !== null);
		const copied = (await clipboardGesture(at.editor, 'copy', copy))['text/plain'] ?? '';
		takeDevWarns();
		if (copied !== expected) {
			const law = atEdge ? 'L10.edge' : 'L10';
			run.lines.push(
				at.line(law, `copy:${copy}`, `wrote ${quote(copied)}, not ${quote(expected)}`)
			);
		}
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

/** How many path steps the two ends share, short of the deeper end's own block. */
function commonDepth(a: readonly number[], b: readonly number[]): number {
	let depth = 0;
	const limit = Math.min(a.length, b.length) - 1;
	while (depth < limit && a[depth] === b[depth]) depth++;
	return depth;
}

// ── Law 11: Paste as plain text never converts ───────────────────────────────

/** Law 11: the menu's Paste as plain text puts `text` in as text the block reads: the bytes change
 *  only at the caret, and what goes in reads as `text` (verbatim where the block reads no Markdown). */
export async function law11(
	input: Omit<LawInput, 'seed'> & { caret: EndSeed },
	text: string
): Promise<LawRun> {
	const run = emptyRun();
	const at = await open({ ...input, seed: { a: input.caret, b: input.caret } }, run, (doc) =>
		resolveCaret(doc, input.caret)
	);
	if (!at) return run;
	try {
		const source = at.editor.source();
		const caret = at.editor.instance.getSelection()!.anchor;
		const grammar = at.editor.instance.__test.getGrammar();
		const positions = bytePositions(source, grammar);
		const byte = positions.get(pointKey(caret.path, caret.offset));
		if (byte === undefined) {
			run.undetermined.push(`no byte for the caret ${pointKey(caret.path, caret.offset)}`);
			return run;
		}
		const kind = leafAt(at.editor.instance.__test.getDocument(), caret.path)?.kind ?? '?';
		const before = snapshot(at);
		await pastePlainGesture(at.editor, text);
		law8(at, 'paste:plain', run);
		const pasted = at.editor.source();
		const grown = pasted.length - source.length;
		const kept =
			grown >= 0 && pasted.startsWith(source.slice(0, byte)) && pasted.endsWith(source.slice(byte));
		const inserted = kept ? pasted.slice(byte, byte + grown) : null;
		// Continuation lines carry their containers' prefixes, which aren't the pasted text.
		const unprefixed = (t: string) => lf(t).replace(/\n[ \t>]*/g, '\n');
		// A pasted line's own line ending goes where nothing visible follows it.
		const bare = (t: string) => t.replace(/\n$/, '');
		const reading = fixtureReading({ grammar });
		const verbatim = kind === 'fencedCode' || kind === 'indentedCode';
		const reads =
			inserted !== null &&
			bare(verbatim ? lf(inserted) : visibleText(unprefixed(inserted), reading)) === bare(text);
		if (!reads) {
			const what =
				inserted === null ? 'changed bytes away from the caret' : `put in ${quote(inserted)}`;
			run.lines.push(
				at.line('L11', 'paste:plain', `${quote(text)} into ${kind} ${what}: ${quote(pasted)}`)
			);
		}
		await law7(at, 'paste:plain', before, run, true);
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

// ── Laws 7 and 8 on their own: any gesture ───────────────────────────────────

export type AnyGesture =
	| { cut: ClipboardRoute }
	| { replacement: Replacement }
	| { deleted: 'Backspace' | 'Delete' }
	| { plain: string };

/** One mutating gesture over the range, then laws 7 and 8. */
export async function afterGesture(input: LawInput | CaretInput, g: AnyGesture): Promise<LawRun> {
	const run = emptyRun();
	const at =
		'caret' in input
			? await open({ ...input, seed: { a: input.caret, b: input.caret } }, run, (doc) =>
					resolveCaret(doc, input.caret)
				)
			: await open(input, run);
	if (!at) return run;
	try {
		const before = snapshot(at);
		let name: string;
		if ('cut' in g) {
			name = `cut:${g.cut}`;
			await clipboardGesture(at.editor, 'cut', g.cut);
		} else if ('deleted' in g) {
			name = g.deleted;
			if (!(await deleteGesture(at.editor, g.deleted))) {
				run.undetermined.push(`${name} was left to the browser`);
				return run;
			}
		} else if ('plain' in g) {
			name = 'paste:plain';
			await pastePlainGesture(at.editor, g.plain);
		} else {
			name = replacementName(g.replacement);
			if (!(await replace(at.editor, g.replacement))) {
				run.undetermined.push(`${name} was left to the browser`);
				return run;
			}
		}
		law8(at, name, run);
		await law7(at, name, before, run, name.startsWith('paste'));
	} catch (error) {
		undecided(run, error);
	} finally {
		await destroy(at);
	}
	return run;
}

export type { Payload };
