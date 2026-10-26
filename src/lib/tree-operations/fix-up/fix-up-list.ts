// Fixes up one list after an edit, so it reads the way a reload of its bytes would
// (`docs/design/syntax-tree.md` § Where the separators get fixed up).
import { isBlankText, ownTrailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { SiblingList, Caret, Host, ListEdit, ListResult } from './types';
import { endMergedLast, endPlaced } from './endings';
import { joinSameLists, partJoin, type Role } from './joins';
import { mergeAcross } from './merge';
import { isBlankBlock } from './reading';
import {
	layOutRun,
	lineGivenBack,
	releaseOpenBlankLine,
	returnFenceLine,
	takeRemovedLines
} from './runs';
import { rereadUnfinished } from './unfinished';
import { finish, startWork, type Work } from './work';

export function fixUpList(
	list: SiblingList,
	edit: ListEdit,
	host: Host,
	caret?: Caret
): ListResult {
	const work = startWork(list, {
		...(caret ? { caret } : {}),
		...(edit.written ? { writtenStart: { index: edit.written.index, offset: 0 } } : {}),
		...(edit.moved
			? {
					movedTo: {
						index: edit.moved.to,
						offset: trimTrailingLineEnding(list.children[edit.moved.to]?.raw ?? '').length
					}
				}
			: {})
	});
	if (!edit.span && !edit.written) return finish(work);
	const typed = !!edit.written && !edit.before;
	const [from, count] = placed(edit);
	if (!typed) endPlaced(work, edit, from, count, host);
	takeRemovedLines(work, edit, from);
	returnFenceLine(work, edit, from, count, host);
	const above = typed && skipsJoinAbove(work, edit) ? from + 1 : from;
	const joins = askedJoins(edit, from, count).filter(([j]) => j >= above || j < from);
	const [giveBack, ending] = lineGivenBack(work, edit, from, count, host) ?? [-1, ''];
	const runs = new Set([
		...joins.map(([j]) => j),
		...Array.from({ length: count }, (_, k) => from + k + 1)
	]);
	for (const j of runs) {
		if (j === giveBack) layOutRun(work, j, host, 1, ending);
		else layOutRun(work, j, host);
	}
	joinSameLists(work, edit, from, count, host);
	for (const [j, role] of joins) partJoin(work, j, role, host, typed);
	// From the bottom up, so a merge never moves a join still to be asked.
	for (const [j] of [...joins].sort((a, b) => b[0] - a[0])) {
		if (j < from || j > from + count) mergeAcross(work, j, j, host);
	}
	mergeAcross(work, above, from + count, host);
	if (!typed) endMergedLast(work, edit, from, count, host);
	rereadUnfinished(work, from, count, host);
	if (from + count >= work.blocks.length) releaseOpenBlankLine(work, host);
	if (edit.moved) followMovedBlock(work, edit.moved.to);
	return finish(work);
}

/** Whether a typed write leaves the join above alone, which it does unless the two touch, the
 *  write moved the block's indent, or the block was or is now blank. */
function skipsJoinAbove(work: Work, edit: ListEdit): boolean {
	const { index, previous, text } = edit.written!;
	const indent = (raw: string) => /^[ \t]*/.exec(raw)![0];
	if (edit.span || isBlankBlock(previous) || isBlankBlock(work.blocks.at(index))) return false;
	if (indent(previous.raw) !== indent(text)) return false;
	return index === 0 || work.blocks.at(index).leadingTrivia !== '';
}

/** The blocks the edit placed (or wrote), as a start and a count in the list as given. */
function placed(edit: ListEdit): [number, number] {
	if (edit.moved) return [edit.moved.to, 1];
	if (edit.span) return [edit.span.at, edit.span.added];
	return [edit.written!.index, 1];
}

/** The joins the edit reaches, each with what the edit did to it: a move asks every join of its
 *  span as placed but the pair it uncovered; a removal asks both joins of the block above it. */
function askedJoins(edit: ListEdit, from: number, count: number): [number, Role][] {
	const { span, moved } = edit;
	const role: Role = moved ? 'placed' : edit.before ? 'rewritten' : 'written';
	const joins: [number, Role][] = [];
	if (moved?.uncovered != null) joins.push([moved.uncovered, 'rewritten']);
	if (edit.removed) joins.push([from - 1, 'rewritten']);
	const [first, last] = moved && span ? [span.at, span.at + span.added] : [from, from + count];
	for (let j = first; j <= last; j += moved ? 1 : Math.max(last - first, 1)) {
		// A rewrite's own first block reads the way its bytes do against the block above.
		joins.push([j, role === 'rewritten' && j === from && count > 0 ? 'written' : role]);
	}
	return joins.filter(([j], i) => j >= 0 && joins.findIndex(([k]) => k === j) === i);
}

/** A moved block another block took in stands where that block does, unless what follows it
 *  there is only blank lines (or it was one itself): then it stands at the next block. */
function followMovedBlock(work: Work, to: number): void {
	const mark = work.marks.movedTo!;
	if (
		work.blocks.origin(mark.index) === to ||
		mark.offset === 0 ||
		mark.index + 1 >= work.blocks.length
	)
		return;
	const rest = work.blocks.at(mark.index).raw.slice(mark.offset);
	const below = rest.slice(ownTrailingLineEnding(rest.slice(0, rest.indexOf('\n') + 1)).length);
	if (isBlankBlock(work.list.children[to]) || (below !== '' && isBlankText(below)))
		work.marks.movedTo = { index: mark.index + 1, offset: 0 };
}
