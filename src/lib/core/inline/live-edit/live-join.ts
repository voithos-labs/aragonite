/**
 * The live-mode join rewrite (live-mode.md § 4.5): a format run the cut went through is closed on
 * the half before it and reopened on the half after, and a closer meeting its own opener around
 * nothing is dropped. Written only once the joined bytes, read back where they will be stored,
 * show what the two sides showed with every kept character's marks.
 */

import {
	constructContentRange,
	getContentRange,
	inlineDescendants,
	isProseKind,
	readInline
} from '../index';
import { CONTENT_VISIBILITY, paintsOnlyChrome, renderedText, visibleRuns } from '../visibility';
import { readBack, readSource, shownRunsOf } from './read-back';
import {
	chordSpelling,
	closeBefore,
	closesAndReopens,
	reopenAfter,
	type CutConstruct
} from './close-reopen';
import { keepsEdgeMarks, losesEdgeMarksOnly, marksShown } from './shown-marks';
import { displayLength, readsAsBlankLine } from '../../lines';
import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';
import type { GrammarView } from '../../../schema/block-openers';
import type { RenderInlineOptions } from '../../inline-render';
import type { InlineNode } from '../../nodes';
import type { NodeView } from '../../node-views';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

/** One side of a join: the block it contributed bytes from and the offset they were cut at. A
 *  merge cuts at the end of the block's content, a range delete at the selection endpoint. */
export interface JoinEndpoint {
	node: NodeView;
	offset: number;
}

/** The bytes a join produced, plus where the second side's contribution starts in them. */
export interface JoinSeam {
	mergedRaw: string;
	seam: number;
	start: JoinEndpoint;
	end: JoinEndpoint;
	/** Text the caller will insert at the join after the cleanup, `''` for a plain delete. The
	 *  cleanup checks it too, since typed text changes what a surviving delimiter pairs against. */
	typed: string;
	/** Where the joined bytes will be stored, with the editor's reading: the cleanup reads each
	 *  candidate back there, a list item's marker line or a cell's text included. */
	store: StoredAs;
}

/** The bytes a cleanup wrote and where the two sides now meet in them: the runs it dropped and the
 *  closers and openers it wrote at the join move the point the caret lands on. */
export interface CleanedJoin {
	raw: string;
	/** Where typed text and the caret go: inside a closed run that grows at its edge. */
	seam: number;
	/** Where the second side's bytes start, past every closer and opener written at the join. */
	seamEnd: number;
	/** Where an offset of the merged bytes lands in `raw`; a byte the cleanup dropped lands where
	 *  its run stood, and the join's own offset lands before the runs written there. */
	map(offset: number): number;
}

/** The join's bytes with each kept half's format kept, or null to keep the plain concatenation. */
export function cleanLiveJoinSeam(join: JoinSeam): CleanedJoin | null {
	const { typed, store } = join;
	const left = readSide(join.start, 'before', store.reading);
	const right = readSide(join.end, 'after', store.reading);
	if (left === null || right === null) return null;
	// Nothing sits at the join, so the plain concatenation is already the answer, and an ordinary
	// Backspace between two paragraphs pays for no parse.
	if (!standsOnSeam(left) && !standsOnSeam(right)) return null;
	if (!anchorsOnMerged(join, left, right)) return null;

	// The caller splices `typed` at the join once this returns, so the bytes checked below are the
	// bytes written: a typed run changes the flanking a kept delimiter pairs against.
	const shown = shownAfterJoin(left, right, typed);
	// Keeping each half's format comes first; dropping the runs the cut stranded is the fallback,
	// least destructive first, where no reading that keeps them shows what the screen showed.
	const pairs = abuttingPairSpans(join, left, right);
	const drops = [pairedPrefix(left, right), 0].map((paired): JoinReading => ({
		edits: [...strandedSpans(join, left, right, paired), ...pairs].map(dropped),
		typedAt: 0,
		keeps: false
	}));
	const written = distinct(
		[...keepingReadings(join, left, right), ...drops].map(({ edits, typedAt, keeps }) => {
			const { raw, map } = withEdits(join.mergedRaw, edits);
			const at = map(join.seam);
			const atJoin = edits.find((edit) => edit.start === join.seam && edit.end === join.seam);
			return { raw, seam: at + typedAt, seamEnd: at + (atJoin?.insert.length ?? 0), map, keeps };
		})
	);
	// A pair left over nothing also passes the screen check, so among the readings that pass, the
	// first leaving the fewest such pairs wins (`docs/design/live-mode.md` § 4.1).
	let best: { written: (typeof written)[number]; residue: number } | null = null;
	let kept: { before: string[]; after: string[] } | null = null;
	for (const candidate of written) {
		const read = readCandidate(
			candidate.raw.slice(0, candidate.seam) + typed + candidate.raw.slice(candidate.seam),
			store
		);
		if (read === null || read.visible !== shown) continue;
		// G1.91: a reading that keeps the runs keeps every kept character's marks, and one that
		// drops runs may unmark a character but never format it.
		kept ??= keptMarks(left, right);
		const fits = candidate.keeps
			? keepsEdgeMarks(read.marks, kept.before, kept.after)
			: losesEdgeMarksOnly(read.formats, kept.before, kept.after);
		if (!fits) continue;
		if (best === null || read.residue < best.residue) {
			best = { written: candidate, residue: read.residue };
		}
		// One leaving no such pair can't lose, so the readings after it go unread.
		if (read.residue === 0) break;
	}
	if (best === null) return null;
	const { raw, seam, seamEnd, map } = best.written;
	// A candidate that changed nothing is the plain concatenation: refusing says so, and keeps the
	// caller off a rewrite path it does not need. Typed text moved past a run is a change.
	if (raw === join.mergedRaw && seam === join.seam) return null;
	// A survivor of whitespace only draws nothing, and would reload as a blank line.
	if (readsAsBlankLine(raw)) {
		return { raw: raw.slice(displayLength(raw)), seam: 0, seamEnd: 0, map: () => 0 };
	}
	return { raw, seam, seamEnd, map };
}

const standsOnSeam = (side: Side): boolean => side.dangling.length > 0 || side.touching.length > 0;

// ── The two sides ────────────────────────────────────────────────────────────

interface Span {
	start: number;
	end: number;
}

interface Side {
	raw: string;
	/** The editor's grammar, which the render reading of this side draws in. */
	grammar: GrammarView;
	content: Span;
	cut: number;
	inlines: readonly InlineNode[];
	/** Constructs the cut left open: an opener kept without its closer, or the reverse. Outermost
	 *  first, so the two sides' lists compare position by position. */
	dangling: CutConstruct[];
	/** Constructs whose delimiter run touches the cut from inside the surviving bytes: the
	 *  trailing closers of the block above, the leading openers of the block below. */
	touching: CutConstruct[];
}

/** The bytes a side's constructs index into, all a spelling reads. */
type SideBytes = Pick<Side, 'raw'>;

/** One endpoint's surviving bytes and the constructs its cut leaves at the join. Null for a
 *  non-prose kind, an offset outside the content, or a cut through a family that cannot reopen. */
function readSide(endpoint: JoinEndpoint, keep: 'before' | 'after', reading: Reading): Side | null {
	const { node, offset } = endpoint;
	if (!isProseKind(node.kind)) return null;
	const content = getContentRange(node);
	if (offset < content.start || offset > content.end) return null;

	const inlines = readInline(
		node.raw,
		content.start,
		content.end,
		reading.resolver,
		reading.grammar
	);
	// Markers standing over nothing are all on screen (live-mode.md § 4.1), so a run that survives
	// this cut is bytes the user saw, not a stranded one: the plain concatenation stands.
	if (paintsOnlyChrome(inlines, node.raw, { grammar: reading.grammar })) return null;
	const { ranged, atomic } = classifyConstructs(inlines);
	// Neither an atomic construct's interior nor the middle of a delimiter run leaves halves any
	// reading can repair. A live-mode caret cannot land there; a plugin's can.
	if (atomic.some((span) => offset > span.start && offset < span.end)) return null;
	if (ranged.some((c) => splitsARun(c, offset))) return null;
	// What matters is whether the partner delimiter survives, not whether the cut lies inside the
	// content range: a cut at a construct's content start leaves its opener behind too.
	const dangling = ranged.filter((c) =>
		keep === 'before'
			? c.contentStart <= offset && offset < c.end
			: c.start < offset && offset <= c.contentEnd
	);
	if (dangling.some((c) => !closesAndReopens(c.kind))) return null;

	return {
		raw: node.raw,
		grammar: reading.grammar,
		content,
		cut: offset,
		inlines,
		dangling,
		touching: touchingChain(ranged, offset, keep)
	};
}

/** Text is content, not a construct, and nothing under it is one either. The two scans below
 *  share this test when they descend. */
const isConstruct = (node: InlineNode): boolean => node.kind !== 'text';

/** Constructs with a content range (outermost first), kept apart from those without one, whose
 *  bytes the join can only step around. */
function classifyConstructs(inlines: readonly InlineNode[]): {
	ranged: CutConstruct[];
	atomic: Span[];
} {
	const ranged: CutConstruct[] = [];
	const atomic: Span[] = [];
	for (const node of inlineDescendants(inlines, isConstruct)) {
		if (node.kind === 'text') continue;
		const content = constructContentRange(node);
		if (!content) {
			atomic.push({ start: node.start, end: node.end });
			continue;
		}
		ranged.push({
			kind: node.kind,
			start: node.start,
			end: node.end,
			contentStart: content.start,
			contentEnd: content.end
		});
	}
	return { ranged, atomic };
}

const splitsARun = (c: CutConstruct, at: number): boolean =>
	(at > c.start && at < c.contentStart) || (at > c.contentEnd && at < c.end);

/** The nested chain of closers ending at `cut` (or openers starting there), outermost first:
 *  `**a *b***` cut at its end gives the strong emphasis, then the emphasis. */
function touchingChain(
	constructs: readonly CutConstruct[],
	cut: number,
	keep: 'before' | 'after'
): CutConstruct[] {
	const chain: CutConstruct[] = [];
	let at = cut;
	for (;;) {
		const link = constructs.find((c) => (keep === 'before' ? c.end === at : c.start === at));
		if (!link || !closesAndReopens(link.kind)) return chain;
		chain.push(link);
		at = keep === 'before' ? link.contentEnd : link.contentStart;
	}
}

/** Whether the merged bytes are still the two sides' bytes end to end. Anything that rewrote
 *  either side moves every offset below, so the cleanup does nothing instead. */
function anchorsOnMerged(
	join: { mergedRaw: string; seam: number },
	left: Side,
	right: Side
): boolean {
	return (
		join.mergedRaw.slice(0, join.seam) === left.raw.slice(0, left.cut) &&
		join.mergedRaw.startsWith(right.raw.slice(right.cut, right.content.end), join.seam)
	);
}

// ── The spans a join may drop ────────────────────────────────────────────────

/** A left-side span is already in merged coordinates; a right-side one shifts by the join. */
const rightSpan = (join: { seam: number }, right: Side, span: Span): Span => ({
	start: join.seam + span.start - right.cut,
	end: join.seam + span.end - right.cut
});

const openerRun = (c: CutConstruct): Span => ({ start: c.start, end: c.contentStart });
const closerRun = (c: CutConstruct): Span => ({ start: c.contentEnd, end: c.end });

/** Whether two constructs are written with the same delimiters: the byte-level test for "these
 *  are one construct's two halves", which matching kinds alone cannot make (`__a__` vs `**a**`). */
const sameDelimiters = (
	left: SideBytes,
	lc: CutConstruct,
	right: SideBytes,
	rc: CutConstruct
): boolean => sameSpelling(asCut(left, lc), asCut(right, rc));

/** How many of the two sides' stranded runs, outermost first, make one construct again across the
 *  join. Exported for the test. */
export function pairedPrefix(
	left: SideBytes & Pick<Side, 'dangling'>,
	right: SideBytes & Pick<Side, 'dangling'>
): number {
	let paired = 0;
	while (
		paired < left.dangling.length &&
		paired < right.dangling.length &&
		left.dangling[paired].kind === right.dangling[paired].kind &&
		sameDelimiters(left, left.dangling[paired], right, right.dangling[paired])
	) {
		paired++;
	}
	return paired;
}

/** The runs a truncation stranded past the first `paired`: the left's openers and the right's
 *  closers. With none paired, every one goes and the joined text stands as plain content. */
function strandedSpans(join: { seam: number }, left: Side, right: Side, paired: number): Span[] {
	return [
		...left.dangling.slice(paired).map(openerRun),
		...right.dangling.slice(paired).map((c) => rightSpan(join, right, closerRun(c)))
	];
}

/** The closer/opener chain a split's inverse brings back to back around nothing, same kinds and
 *  bytes. Dropped whole or not at all, since a partial drop leaves the runs unbalanced. */
function abuttingPairSpans(join: { seam: number }, left: Side, right: Side): Span[] {
	const closing = left.touching;
	const opening = right.touching;
	if (closing.length === 0 || closing.length !== opening.length) return [];
	for (let i = 0; i < closing.length; i++) {
		if (closing[i].kind !== opening[i].kind) return [];
		if (!sameDelimiters(left, closing[i], right, opening[i])) return [];
	}
	return [
		{ start: closing[closing.length - 1].contentEnd, end: left.cut },
		rightSpan(join, right, {
			start: right.cut,
			end: opening[opening.length - 1].contentStart
		})
	];
}

const dropped = (span: Span): Edit => ({ ...span, insert: '' });

/** `raw` with `edits` applied, and where each of its offsets lands in the result. */
function withEdits(
	raw: string,
	edits: readonly Edit[]
): { raw: string; map: (offset: number) => number } {
	const applied: Edit[] = [];
	let out = '';
	let at = 0;
	// At one offset, bytes written there go before bytes dropped from there.
	const order = (a: Edit, b: Edit) => a.start - b.start || a.end - a.start - (b.end - b.start);
	for (const edit of [...edits].sort(order)) {
		if (edit.start < at) continue;
		applied.push(edit);
		out += raw.slice(at, edit.start) + edit.insert;
		at = edit.end;
	}
	const map = (offset: number): number => {
		let shift = 0;
		for (const edit of applied) {
			if (offset <= edit.start) break;
			if (offset < edit.end) return edit.start + shift;
			shift += edit.insert.length - (edit.end - edit.start);
		}
		return offset + shift;
	};
	return { raw: out + raw.slice(at), map };
}

// ── The readings that keep each half's format ────────────────────────────────

interface Edit extends Span {
	insert: string;
}

/** One way to write the join: the edits to the merged bytes, where in the bytes written at the
 *  join the typed text and the caret go, and whether it claims to keep every kept character's marks. */
interface JoinReading {
	edits: Edit[];
	typedAt: number;
	keeps: boolean;
}

/** A construct's delimiters as one reading writes them. */
type Spelling = (side: SideBytes, c: CutConstruct) => { opener: string; closer: string };

const asCut: Spelling = (side, c) => ({
	opener: side.raw.slice(c.start, c.contentStart),
	closer: side.raw.slice(c.contentEnd, c.end)
});

const asRow: Spelling = (side, c) => chordSpelling(side.raw, c);

/** The cut's own bytes first, the boundary space moved outside the runs next, then the runs in
 *  their rows' own markers, for a spelling that cannot close mid-word. */
function keepingReadings(join: JoinSeam, left: Side, right: Side): JoinReading[] {
	const readings = [
		keepingReading(join, left, right, asCut, false),
		keepingReading(join, left, right, asCut, true)
	];
	const open = [
		...left.dangling.map((c) => [left, c] as const),
		...right.dangling.map((c) => [right, c] as const)
	];
	if (open.some(([side, c]) => asRow(side, c).opener !== asCut(side, c).opener)) {
		readings.push(keepingReading(join, left, right, asRow, false));
	}
	return readings.filter((reading): reading is JoinReading => reading !== null);
}

/** The left half's open runs closed at the cut and the right half's reopened; the outermost runs
 *  meeting there with the same delimiters stay one. Null for `spaced` with no boundary space. */
function keepingReading(
	join: JoinSeam,
	left: Side,
	right: Side,
	spell: Spelling,
	spaced: boolean
): JoinReading | null {
	const { typed } = join;
	// Typed text takes the format of the character before it, outside a run that never grows at
	// its edge and everything inside that run (`docs/design/live-mode.md` § 4.2).
	const grows = typed === '' ? 0 : outsideNeverExtend(join, left, right);
	const outer = left.dangling.slice(0, grows);
	const inner = closeBefore(left.raw, left.dangling.slice(grows), left.cut);
	const innerClosed = [...inner.closed].reverse();
	const opened = reopenAfter(right.raw, right.dangling, right.cut);
	const reopened = [...opened.reopened].reverse();
	const closed = [...outer, ...innerClosed];

	// Read where the kept bytes now end and start, since an emptied run's delimiters go with it.
	const leftTouching = touchingAt(left, inner.end, 'before');
	const rightTouching = touchingAt(right, opened.start, 'after');
	// Outermost first on both sides, so the runs that can stay one are a common prefix.
	const closing = [...closed, ...leftTouching];
	const opening = [...reopened, ...rightTouching];
	const spelled = (side: Side, c: CutConstruct, writes: readonly CutConstruct[]) =>
		writes.includes(c) ? spell(side, c) : asCut(side, c);
	let merged = 0;
	while (
		merged < closing.length &&
		merged < opening.length &&
		closing[merged].kind === opening[merged].kind &&
		sameSpelling(spelled(left, closing[merged], closed), spelled(right, opening[merged], reopened))
	) {
		merged++;
	}
	const stays = (c: CutConstruct, list: readonly CutConstruct[]) =>
		list.includes(c) &&
		!closing.slice(0, merged).includes(c) &&
		!opening.slice(0, merged).includes(c);
	const closersOf = (list: readonly CutConstruct[]) =>
		list
			.filter((c) => stays(c, list))
			.reverse()
			.map((c) => spell(left, c).closer)
			.join('');
	const innerClosers = closersOf(innerClosed);
	const outerClosers = closersOf(outer);
	const openers = reopened
		.filter((c) => stays(c, reopened))
		.map((c) => spell(right, c).opener)
		.join('');

	const closers = innerClosers + outerClosers;
	let leftEnd = inner.end;
	let rightStart = opened.start;
	let before = false;
	let space = '';
	if (spaced) {
		// A run can't close after whitespace or open before it, so a boundary space steps outside.
		before = typed === '' && closers !== '' && left.raw[leftEnd - 1] === ' ';
		const after = openers !== '' && right.raw[rightStart] === ' ';
		if (!before && !after) return null;
		if (before) leftEnd--;
		if (after) rightStart++;
		space = (before ? ' ' : '') + (after ? ' ' : '');
	}

	const edits: Edit[] = [{ start: join.seam, end: join.seam, insert: closers + space + openers }];
	if (leftEnd < left.cut) edits.push(dropped({ start: leftEnd, end: left.cut }));
	if (rightStart > right.cut) {
		edits.push(dropped(rightSpan(join, right, { start: right.cut, end: rightStart })));
	}
	const leftMerged = closing.slice(0, merged).filter((c) => leftTouching.includes(c));
	const rightMerged = opening.slice(0, merged).filter((c) => rightTouching.includes(c));
	if (leftMerged.length > 0) {
		const deepest = leftMerged[leftMerged.length - 1];
		edits.push(dropped({ start: deepest.contentEnd, end: inner.end }));
	}
	if (rightMerged.length > 0) {
		const deepest = rightMerged[rightMerged.length - 1];
		const span = { start: opened.start, end: deepest.contentStart };
		edits.push(dropped(rightSpan(join, right, span)));
	}
	// A run written in its row's markers is rewritten at its other end too.
	for (const c of closed) {
		const { opener } = spell(left, c);
		if (opener !== asCut(left, c).opener) edits.push({ ...openerRun(c), insert: opener });
	}
	for (const c of reopened) {
		const { closer } = spell(right, c);
		if (closer !== asCut(right, c).closer) {
			edits.push({ ...rightSpan(join, right, closerRun(c)), insert: closer });
		}
	}
	// The caret stays where the cut began, so it goes past a space that stepped outside the run.
	const typedAt = before ? closers.length + 1 : typed === '' ? 0 : innerClosers.length;
	return { edits, typedAt, keeps: true };
}

/** The chain of runs touching `at` from inside `side`'s kept bytes, outermost first. */
const touchingAt = (side: Side, at: number, keep: 'before' | 'after'): CutConstruct[] =>
	at === side.cut
		? side.touching
		: touchingChain(classifyConstructs(side.inlines).ranged, at, keep);

const sameSpelling = (
	a: { opener: string; closer: string },
	b: { opener: string; closer: string }
): boolean => a.opener === b.opener && a.closer === b.closer;

/** How many of the left side's open runs (outermost first) typed text fills: those outside its
 *  outermost never-extend run, unless the cut leaves its text on both sides or is one whole object. */
function outsideNeverExtend(join: JoinSeam, left: Side, right: Side): number {
	const sameLeaf = join.start.node === join.end.node;
	const object =
		sameLeaf &&
		[...inlineDescendants(left.inlines, isConstruct)].some(
			(node) =>
				node.kind !== 'text' &&
				!closesAndReopens(node.kind) &&
				node.start === left.cut &&
				node.end === right.cut
		);
	const inside = (c: CutConstruct) => {
		const twin = right.dangling.find((r) => r.start === c.start && r.kind === c.kind);
		if (!sameLeaf || twin === undefined) return false;
		return (
			object ||
			(showsText(left, c.contentStart, left.cut) && showsText(right, right.cut, twin.contentEnd))
		);
	};
	const at = left.dangling.findIndex(
		(c) => getInlineConstructPolicy(c.kind)?.edgeAffinity === 'never-extend' && !inside(c)
	);
	return at < 0 ? left.dangling.length : at;
}

/** Whether `[from, to)` of `side` shows a character, a run's hidden delimiters counting as none. */
const showsText = (side: Side, from: number, to: number): boolean =>
	from < to &&
	visibleRuns(side.inlines, side.raw, CONTENT_VISIBILITY, { grammar: side.grammar }).some(
		(run) => run.visible && run.text !== '' && run.start < to && run.end > from
	);

/** Readings that write the same bytes are read once; a dropping one among them lifts the claim to
 *  keep every mark, since a drop may lose one. */
function distinct<T extends { raw: string; seam: number; keeps: boolean }>(candidates: T[]): T[] {
	const out: T[] = [];
	for (const candidate of candidates) {
		const same = out.find((seen) => seen.raw === candidate.raw && seen.seam === candidate.seam);
		if (!same) out.push(candidate);
		else if (!candidate.keeps) same.keeps = false;
	}
	return out;
}

/** The marks the two sides' kept characters carry, read off each side's own render. */
function keptMarks(left: Side, right: Side): { before: string[]; after: string[] } {
	const marksOf = (side: Side, from: number, to: number) =>
		marksShown(
			visibleRuns(side.inlines, side.raw, CONTENT_VISIBILITY, { grammar: side.grammar }),
			side.inlines,
			side.raw,
			from,
			to
		);
	return {
		before: marksOf(left, left.content.start, left.cut),
		after: marksOf(right, right.cut, right.content.end)
	};
}

// ── Verification ─────────────────────────────────────────────────────────────

/** What the user must still see, read off each side's parse from before the join: reading the
 *  joined halves would bake the fault this checks for into the expectation. */
const shownAfterJoin = (left: Side, right: Side, typed: string): string =>
	visibleSide(left, 'before') + typed + visibleSide(right, 'after');

/** What the user sees of one side, asked of the render with every marker dropped. A construct the
 *  cut crosses still gives its content, since `readSide` refused any side whose markers paint. */
function visibleSide(side: Side, keep: 'before' | 'after'): string {
	return renderedText(clipNodes(side.inlines, side.cut, keep), side.raw, CONTENT_VISIBILITY, {
		grammar: side.grammar
	});
}

/** The `keep` side of `level`, rebuilt: a construct the cut crosses is replaced by its clipped
 *  children. Exported for the depth test. */
export function clipNodes(
	level: readonly InlineNode[],
	cut: number,
	keep: 'before' | 'after'
): InlineNode[] {
	const before = keep === 'before';
	// A crossed construct is emitted as its children, in its own place, so the pre-order's
	// emission order is the rebuilt list's order.
	const crossed = (node: InlineNode): boolean =>
		isConstruct(node) && node.start < cut && node.end > cut;
	const out: InlineNode[] = [];
	for (const node of inlineDescendants(level, crossed)) {
		if (before ? node.end <= cut : node.start >= cut) {
			out.push(node);
			continue;
		}
		if (before ? node.start >= cut : node.end <= cut) continue;
		if (node.kind === 'text') {
			out.push({ ...node, ...(before ? { end: cut } : { start: cut }) });
			continue;
		}
		const content = constructContentRange(node);
		if (!content) continue;
		if (node.children && node.children.length > 0) continue;
		// A code span carries its content as bytes rather than children, so the surviving part of
		// it is that byte range read as text, which is exactly what the span shows.
		const start = before ? content.start : Math.max(content.start, cut);
		const end = before ? Math.min(content.end, cut) : content.end;
		if (end > start) out.push({ kind: 'text', start, end });
	}
	return out;
}

/** The candidate read back where it will be stored: what it shows, in which marks, and how many
 *  unwrapping constructs stand over nothing. Null where it would not stay one prose block. */
function readCandidate(
	raw: string,
	store: StoredAs
): { visible: string; marks: string[]; formats: string[]; residue: number } | null {
	const read = readBack(raw, store);
	if (read === null) return null;
	const { inlines } = read;
	const source = readSource(read);
	const render = { grammar: store.reading.grammar };
	const { shown, runs } = shownRunsOf(read, store);
	return {
		visible: shown,
		marks: marksShown(runs, inlines, source, 0, source.length),
		// A URL the joined text reads as is the text's own reading, not a format put on it.
		formats: marksShown(runs, inlines, source, 0, source.length, isFormat),
		// Markers over nothing are all on screen (§ 4.1), so a block that shows them hides no pair.
		residue: paintsOnlyChrome(inlines, source, render) ? 0 : countResidue(inlines, source, render)
	};
}

const isFormat = (kind: InlineNode['kind']): boolean =>
	getInlineConstructPolicy(kind)?.mark !== undefined;

/** Constructs the user would meet as nothing at all: no visible byte, and a policy that unwraps
 *  them when emptied rather than leaving delimiters over nothing. */
function countResidue(
	nodes: readonly InlineNode[],
	raw: string,
	render: RenderInlineOptions
): number {
	let found = 0;
	for (const node of inlineDescendants(nodes, isConstruct)) {
		if (node.kind === 'text') continue;
		if (
			node.end > node.start &&
			renderedText([node], raw, CONTENT_VISIBILITY, render) === '' &&
			getInlineConstructPolicy(node.kind)?.autoUnwrapOnEmpty === true
		) {
			found++;
		}
	}
	return found;
}
