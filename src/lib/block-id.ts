import type { CstNode } from './core/nodes';
import type { NodeView } from './core/node-views';

// A per-module-instance prefix: a dev-server reload restarts the counter while the live tree
// still holds ids created before it, and a repeat collides in Svelte's keyed each.
const RUN = Math.random().toString(36).slice(2, 8);
let sequence = 0;

/** Keys for Svelte's `{#each}`: unique within the process and cheap per block, not unguessable. */
export function generateBlockId(): string {
	sequence += 1;
	return `b${RUN}-${sequence}`;
}

// `childIds` is the one field safe to write even on a node an undo snapshot shares. Sized from
// `length`, so a `$state` array costs one proxy read, not one per child.
export function assignIds(children: readonly NodeView[]): string[] {
	const ids = new Array<string>(children.length);
	for (let i = 0; i < ids.length; i++) ids[i] = generateBlockId();
	return ids;
}

/** Ids for `next`, a re-read of `previous`: an unchanged run at either end keeps its ids, the first
 *  changed block keeps its own (the edit was in it), and each block the re-read made is new. */
export function idsAcrossReread(
	previous: readonly NodeView[],
	ids: readonly string[] | undefined,
	next: readonly NodeView[]
): string[] | undefined {
	if (!ids || ids.length !== previous.length) return undefined;
	const { head, tail } = unchangedEnds(previous, next);
	const changed = previous.length - head - tail;
	const created = Array.from({ length: next.length - head - tail }, (_, i) =>
		i === 0 && changed > 0 ? ids[head] : generateBlockId()
	);
	return [...ids.slice(0, head), ...created, ...ids.slice(previous.length - tail)];
}

/** `next`, a re-read of `previous`, takes back the children whose bytes it left alone, and the ids.
 *  A kept node an undo entry holds stays shared, so a write copies it first (G1.9). */
export function keepUnchanged(previous: CstNode, next: CstNode): void {
	keepChildren(previous, next);
}

/** {@link keepUnchanged} at every depth, down the first changed child. Only for bytes written from
 *  outside the tree: a keystroke's leaf can show text its re-read moved, which a kept id would hide. */
export function keepUnchangedDeep(previous: CstNode, next: CstNode): void {
	const changed = keepChildren(previous, next);
	if (changed !== null) keepUnchangedDeep(previous.children![changed], next.children![changed]);
}

/** Where `next`'s first changed child is, when both sides still hold one there. */
function keepChildren(previous: CstNode, next: CstNode): number | null {
	if (previous.kind !== next.kind || !previous.children || !next.children) return null;
	const [was, now] = [previous.children, next.children];
	next.childIds = idsAcrossReread(was, previous.childIds, now);
	const { head, tail } = unchangedEnds(was, now);
	for (let i = 0; i < head; i++) now[i] = was[i];
	for (let i = 1; i <= tail; i++) now[now.length - i] = was[was.length - i];
	return head < was.length - tail && head < now.length - tail ? head : null;
}

const same = (a: NodeView, b: NodeView): boolean =>
	a.kind === b.kind && a.leadingTrivia === b.leadingTrivia && a.raw === b.raw;

/** How many blocks at the start, then at the end, `next` holds as `previous` did. */
function unchangedEnds(previous: readonly NodeView[], next: readonly NodeView[]) {
	const shorter = Math.min(previous.length, next.length);
	let head = 0;
	while (head < shorter && same(previous[head], next[head])) head++;
	let tail = 0;
	while (
		tail < shorter - head &&
		same(previous[previous.length - 1 - tail], next[next.length - 1 - tail])
	)
		tail++;
	return { head, tail };
}

/** Call before a freshly parsed subtree is spliced in: a reused container reads `childIds` in its
 *  keyed each synchronously, so a missing array shows up as `undefined` keys. */
export function assignChildIdsDeep(node: NodeView): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}
