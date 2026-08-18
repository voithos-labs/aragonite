// Map a reorder drag's pointer to the insertion gap it sits nearest. `edges` are the
// row/column boundaries in pointer space, so N tracks yield N+1 edges. The result is a
// gap index, not the occupied cell `table-drag-hit-test` returns.

export function dropGapIndex(pointer: number, edges: number[]): number {
	let nearest = 0;
	let nearestDistance = Infinity;
	for (let i = 0; i < edges.length; i++) {
		const distance = Math.abs(pointer - edges[i]);
		// Strict `<` keeps the lower gap when the pointer is exactly equidistant.
		if (distance < nearestDistance) {
			nearest = i;
			nearestDistance = distance;
		}
	}
	return nearest;
}
