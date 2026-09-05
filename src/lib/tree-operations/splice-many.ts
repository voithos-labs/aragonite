/**
 * The splice every mutation door owes a document-scaled list. A spread hands the engine one
 * argument per item, and a list past its argument limit raises "Maximum call stack size exceeded"
 * at the call (G4.60), so a list too long for one call goes in chunks. Splices in place, so the
 * array keeps its identity and a `$state` proxy sees the writes a hand-rolled splice would make.
 */

/** Well under the engine's argument ceiling, which measures around 125,000 on a desktop V8. */
const INSERT_CHUNK = 50_000;

export function spliceMany<T>(
	target: T[],
	at: number,
	deleteCount: number,
	items: readonly T[]
): void {
	// One call while the list fits in one: splitting the delete off costs a second O(n) shift of
	// the tail, which every structural commit would pay over the document's id and ref arrays.
	if (items.length <= INSERT_CHUNK) {
		target.splice(at, deleteCount, ...items);
		return;
	}
	// Splice's own start resolution, held fixed while the chunks shift the tail under it.
	const start = at < 0 ? Math.max(target.length + at, 0) : Math.min(at, target.length);
	target.splice(start, deleteCount);
	for (let from = 0; from < items.length; from += INSERT_CHUNK) {
		target.splice(start + from, 0, ...items.slice(from, from + INSERT_CHUNK));
	}
}
