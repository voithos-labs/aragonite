// A block's last line ending, given or given up, down the children holding that line.
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { Host, ListEdit } from './types';
import type { Work } from './work';
import { bodyStart } from './reading';

/** `node` with its last line ended by `ending`, or `node` itself when it already ends. */
export function endLastLine(
	node: CstNode | undefined,
	ending: string,
	host: Host
): CstNode | undefined {
	if (!node || ownTrailingLineEnding(node.raw) !== '') return node;
	return rewriteLastLine(node, (text) => text + ending, host);
}

/** `node` with its last line's ending given up. */
export const withoutLastEnding = (node: CstNode, host: Host): CstNode =>
	rewriteLastLine(node, trimTrailingLineEnding, host);

/** Rewrites the line down the path of containers holding it, then rebuilds the path upward. */
function rewriteLastLine(node: CstNode, rewrite: (text: string) => string, host: Host): CstNode {
	const path: { container: CstNode; inner: number; own: boolean }[] = [];
	let leaf: CstNode | undefined = node;
	while (leaf?.children) {
		// A quote's closing blank line is its own while it holds one, or while the quote is unended.
		const last: CstNode | undefined = leaf.children[leaf.children.length - 1];
		const own: boolean =
			host.kindTraits(leaf.kind).stripContainer &&
			last !== undefined &&
			(!!leaf.innerSuffix || last.raw.endsWith('\n') !== leaf.raw.endsWith('\n'));
		const inner: number = own ? -1 : host.childWithLastLine(leaf);
		path.push({ container: leaf, inner, own });
		leaf = inner >= 0 ? leaf.children[inner] : undefined;
	}
	let rebuilt = leaf && { ...leaf, raw: rewrite(leaf.raw) };
	for (const { container, inner, own } of path.reverse()) {
		const changed: CstNode = { ...container, raw: rewrite(container.raw) };
		if (inner >= 0)
			changed.children = container.children!.map((child, i) => (i === inner ? rebuilt! : child));
		else if (own) changed.innerSuffix = rewrite(container.innerSuffix ?? '');
		rebuilt = host.containerAfterRewrite(changed, container.raw).node;
	}
	return rebuilt!;
}

/** Every placed block, and the block right above them, ends its last line. */
export function endPlaced(
	work: Work,
	edit: ListEdit,
	from: number,
	count: number,
	host: Host
): void {
	// A title row sits on its container's first line and a table cell inside its row's line.
	const owner = work.list.owner;
	const cells = owner !== undefined && host.kindTraits(owner.kind).grid;
	for (let i = Math.max(from - 1, bodyStart(work, host)); i < from + count; i++) {
		if (cells && !host.kindTraits(work.blocks.at(i).kind).grid) continue;
		endLine(work, i, host, edit.endingsFromBelow);
	}
}

/** After a move or a removal, a merge that read the list's unended last block anew, or into a
 *  placed block, ends it. */
export function endMergedLast(
	work: Work,
	edit: ListEdit,
	from: number,
	count: number,
	host: Host
): void {
	if (!edit.moved && !edit.removed) return;
	const [first, placed] = edit.moved && edit.span ? [edit.span.at, edit.span.added] : [from, count];
	const last = work.blocks.length - 1;
	const origin = work.blocks.origin(last);
	if (origin === -1 || (origin >= first - 1 && origin < first + placed)) endLine(work, last, host);
}

/** Ends block `index`'s last line; with `fromBelow`, by the bare line ending the block below starts
 *  its blank lines with, when it has one, so no byte is added. */
function endLine(work: Work, index: number, host: Host, fromBelow = false): void {
	const below = work.blocks.at(index + 1);
	const taken = fromBelow ? /^\r?\n/.exec(below?.leadingTrivia ?? '')?.[0] : undefined;
	if (fromBelow && !taken) return;
	const ended = endLastLine(work.blocks.at(index), taken ?? work.list.lineEnding, host);
	if (!ended || ended === work.blocks.at(index)) return;
	work.blocks.set(index, ended);
	if (taken)
		work.blocks.set(index + 1, {
			...below,
			leadingTrivia: below.leadingTrivia.slice(taken.length)
		});
}
