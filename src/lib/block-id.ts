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

/** {@link idsAcrossReread} at every depth of `next`, a re-read of `previous`: a child that keeps
 *  its id is the block it was, so its own children keep theirs. */
export function carryIdsDeep(previous: NodeView, next: NodeView): void {
	if (previous.kind !== next.kind || !previous.children || !next.children) return;
	const ids = idsAcrossReread(previous.children, previous.childIds, next.children);
	if (!ids) return;
	next.childIds = ids;
	const [was, now] = [previous.children, next.children];
	const { head, tail } = unchangedEnds(was, now);
	for (let i = 0; i < head; i++) copyIdsDeep(was[i], now[i]);
	for (let i = 1; i <= tail; i++) copyIdsDeep(was[was.length - i], now[now.length - i]);
	if (ids[head] !== undefined && ids[head] === previous.childIds![head]) {
		carryIdsDeep(was[head], now[head]);
	}
}

/** Blocks with the same bytes hold the same children, so the ids copy down as they stand. */
function copyIdsDeep(previous: NodeView, next: NodeView): void {
	if (!previous.childIds || !next.children) return;
	next.childIds = [...previous.childIds];
	for (let i = 0; i < next.children.length; i++)
		copyIdsDeep(previous.children![i], next.children[i]);
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
