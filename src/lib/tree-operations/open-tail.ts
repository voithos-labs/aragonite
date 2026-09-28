/**
 * The document's open last line: only the last line may lack a line ending, and after a structural
 * edit it lacks one exactly when it did before, unless that line is blank. The commit calls these
 * steps around every structural edit, so no edit writes the tail's ending by hand
 * (`docs/design/syntax-tree.md` § Blank lines).
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import {
	endsInBlankLine,
	ownTrailingLineEnding,
	terminateLine,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import type { BodyParent } from './node-primitives';
import type { StructuralChange } from './structural-change';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { dropChildSpans } from '../schema/child-spans';
import { getBlockKindDescriptor, isGridKind } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';

// ── The commit's steps ───────────────────────────────────────────────────────

/** Whether the document's last line has no line ending; the commit reads it before the edit. */
export function endsOpen(doc: DocumentView): boolean {
	const last = doc.children.at(-1);
	return doc.suffix === '' && last !== undefined && ownTrailingLineEnding(last.raw) === '';
}

/** Every block the change placed, and the block above them, ends its line. Run before the
 *  separator fix-up, which reads their bytes side by side. */
export function endWindowLines(
	body: BodyParent,
	change: StructuralChange,
	sharing: SharingState
): void {
	if (change.op === 'noop') return;
	const placed =
		change.op === 'insert' ? change.count : change.op === 'replace' ? change.newCount : 0;
	const children = body.children;
	// A title row sits on the container's own opener line, so it is no line of the body's.
	const bodyStart = body.owner && reservedChromeKindOf(body.owner.kind) ? 1 : 0;
	const lo = Math.max(change.at - 1, bodyStart);
	const hi = Math.min(change.at + placed, children.length);
	for (let i = lo; i < hi; i++) {
		if (!isLine(body.owner, children[i]) || ownTrailingLineEnding(children[i].raw) !== '') continue;
		terminateLastLine(ensureUnsharedChild(body, i, sharing), body.lineEnding, sharing);
	}
}

/** When the document ended open before the commit, the block now last gives its ending up, unless
 *  its last line is blank. Run after the containers rebuild, since it writes each level's raw. */
export function keepOpenTail(doc: Document, wasOpen: boolean, sharing: SharingState): void {
	if (!wasOpen || doc.suffix !== '') return;
	const lastIndex = doc.children.length - 1;
	const last = doc.children[lastIndex];
	if (!last || ownTrailingLineEnding(last.raw) === '' || endsInBlankLine(last.raw)) return;
	releaseLastLine(ensureUnsharedChild(doc, lastIndex, sharing), sharing);
}

// ── The walk down the last line ──────────────────────────────────────────────

/** A row's cells sit inside one line, so only a grid's own rows count as lines of its body. */
function isLine(owner: NodeView | undefined, child: NodeView): boolean {
	return !owner || !isGridKind(owner.kind) || isGridKind(child.kind);
}

/**
 * End the node's last line in `ending`, in its own raw and in every node below holding that line,
 * so a container's other lines (a quote's lazy continuation lines) keep their bytes.
 */
function terminateLastLine(node: CstNode, ending: LineEnding, sharing: SharingState): void {
	rewriteLastLine(node, (raw) => terminateLine(raw, ending), sharing);
}

function releaseLastLine(node: CstNode, sharing: SharingState): void {
	rewriteLastLine(node, trimTrailingLineEnding, sharing);
}

function rewriteLastLine(
	node: CstNode,
	write: (raw: string) => string,
	sharing: SharingState
): void {
	const wasEnded = node.raw.endsWith('\n');
	const raw = write(node.raw);
	if (raw === node.raw) return;
	node.raw = raw;
	const last = (node.children?.length ?? 0) - 1;
	if (last < 0) return;
	const contract = getBlockKindDescriptor(node.kind).containerContract;
	if (contract === 'strip') {
		dropChildSpans(node);
		// A blank line closing the body is the last line; the parser keeps it out of the suffix
		// while it is unended, so a last child already ended the other way marks it too.
		if (node.innerSuffix || node.children![last].raw.endsWith('\n') !== wasEnded) {
			node.innerSuffix = write(node.innerSuffix ?? '');
			return;
		}
	} else if (contract !== 'grid' || !isGridKind(node.children![last].kind)) {
		// A grid's rows are whole lines; a row's cells and an opaque body sit inside a line.
		return;
	}
	rewriteLastLine(ensureUnsharedChild(node, last, sharing), write, sharing);
}
