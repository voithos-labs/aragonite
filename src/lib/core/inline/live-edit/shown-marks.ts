/**
 * What a render shows of a span and the formats on each character it shows, so a live rewrite can
 * check that every character it keeps keeps its formats (`docs/design/live-mode.md` § 2).
 */

import type { InlineNode } from '../../nodes';
import { constructContentRange, inlineDescendants } from '../index';
import type { VisibleRun } from '../visibility';
import { markSpelling } from './close-reopen';

/** Between one character's marks: a link's destination can hold a space. */
const MARK_SEPARATOR = '\u0001';

/** The marks on each visible character of `[from, to)`, whitespace left out: its enclosing
 *  constructs of the kinds `counts` takes, outermost first, a link with its destination. */
export function marksShown(
	runs: readonly VisibleRun[],
	inlines: readonly InlineNode[],
	raw: string,
	from: number,
	to: number,
	counts: (kind: InlineNode['kind']) => boolean = () => true
): string[] {
	const enclosing: { content: { start: number; end: number }; mark: string }[] = [];
	for (const node of inlineDescendants(inlines)) {
		const content = node.kind === 'text' ? null : constructContentRange(node);
		if (!content || !counts(node.kind)) continue;
		const mark = markSpelling(node.kind) ?? raw.slice(content.end, node.end);
		enclosing.push({ content, mark: `${node.kind}${mark}` });
	}
	const out: string[] = [];
	for (const run of runs) {
		if (!run.visible || run.end <= from || run.start >= to) continue;
		// A widget's text is not its bytes, so all of it stands at its source range.
		const isBytes = run.text.length === run.end - run.start;
		for (let i = 0; i < run.text.length; i++) {
			const at = isBytes ? run.start + i : run.start;
			const end = isBytes ? at + 1 : run.end;
			if (at < from || end > to || /\s/.test(run.text[i])) continue;
			const marks = enclosing.filter(({ content }) => content.start <= at && end <= content.end);
			out.push(marks.map(({ mark }) => mark).join(MARK_SEPARATOR));
		}
	}
	return out;
}

/** What `[from, to)` of a read shows: its text, and the marks on each non-whitespace character. */
export interface ShownSpan {
	visible: string;
	marks: string[];
}

export function shownSpan(
	runs: readonly VisibleRun[],
	inlines: readonly InlineNode[],
	raw: string,
	from: number,
	to: number
): ShownSpan {
	let visible = '';
	for (const run of runs) {
		if (!run.visible || run.end <= from || run.start >= to) continue;
		if (run.text.length !== run.end - run.start) {
			if (run.start >= from && run.end <= to) visible += run.text;
			continue;
		}
		visible += run.text.slice(
			Math.max(0, from - run.start),
			Math.min(run.text.length, to - run.start)
		);
	}
	return { visible, marks: marksShown(runs, inlines, raw, from, to) };
}

/** Whether `read` shows `before`, then `landed`, then `after`, each kept character in its own
 *  marks; the landed text may also take the marks of the run it landed in. */
export function landsKeepingMarks(
	read: ShownSpan,
	parts: { before: ShownSpan; landed: ShownSpan; after: ShownSpan }
): boolean {
	const { before, landed, after } = parts;
	if (read.visible !== before.visible + landed.visible + after.visible) return false;
	if (read.marks.length !== before.marks.length + landed.marks.length + after.marks.length) {
		return false;
	}
	const middle = read.marks.slice(before.marks.length, before.marks.length + landed.marks.length);
	return (
		keepsEdgeMarks(read.marks, before.marks, after.marks) &&
		landed.marks.every((mark, i) => holdsMarks(middle[i], mark))
	);
}

/** Whether `marks` open with `before` and end with `after`, whatever stands between them. */
export function keepsEdgeMarks(
	marks: readonly string[],
	before: readonly string[],
	after: readonly string[]
): boolean {
	return edgeMarksFit(marks, before, after, (was, now) => was === now);
}

/** {@link keepsEdgeMarks} with marks allowed to go but none of `marks` to arrive: what a dropped
 *  run shows. */
export function losesEdgeMarksOnly(
	marks: readonly string[],
	before: readonly string[],
	after: readonly string[]
): boolean {
	return edgeMarksFit(marks, before, after, holdsMarks);
}

function edgeMarksFit(
	marks: readonly string[],
	before: readonly string[],
	after: readonly string[],
	fits: (was: string, now: string) => boolean
): boolean {
	if (marks.length < before.length + after.length) return false;
	const tail = marks.slice(marks.length - after.length);
	return (
		before.every((was, i) => fits(was, marks[i])) && after.every((was, i) => fits(was, tail[i]))
	);
}

/** A read's characters with their marks, whitespace left out, one entry per code unit. */
interface MarkedRun {
	chars: readonly string[];
	marks: readonly string[];
}

/** Whether `read` shows `before`'s characters first and `after`'s last, each in at most the marks
 *  it had, whatever other characters stand among them. */
export function losesMarksAround(read: MarkedRun, before: MarkedRun, after: MarkedRun): boolean {
	const runs = [read, before, after];
	if (runs.some(({ chars, marks }) => chars.length !== marks.length)) return false;
	let at = 0;
	for (let i = 0; i < before.chars.length; i++, at++) {
		while (at < read.chars.length && read.chars[at] !== before.chars[i]) at++;
		if (at === read.chars.length || !holdsMarks(before.marks[i], read.marks[at])) return false;
	}
	let end = read.chars.length - 1;
	for (let i = after.chars.length - 1; i >= 0; i--, end--) {
		while (end >= at && read.chars[end] !== after.chars[i]) end--;
		if (end < at || !holdsMarks(after.marks[i], read.marks[end])) return false;
	}
	return true;
}

/** Whether `outer`'s marks include every one of `inner`'s, in order. */
function holdsMarks(outer: string, inner: string): boolean {
	const want = inner === '' ? [] : inner.split(MARK_SEPARATOR);
	let at = 0;
	for (const mark of outer === '' ? [] : outer.split(MARK_SEPARATOR)) {
		if (at < want.length && want[at] === mark) at++;
	}
	return at === want.length;
}
