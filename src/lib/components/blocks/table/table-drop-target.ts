// Map a reorder drag's pointer to the insertion gap it sits nearest. `edges` are
// the row/column boundary coordinates in pointer space: N rows/columns yield N+1
// edges (leading edge, the inter-track boundaries, trailing edge). The returned
// index is the gap to drop into — distinct from table-drag-hit-test, which maps a
// point to an occupied cell for selection.

function nearestEdgeIndex(pointer: number, edges: number[]): number {
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

export function rowDropIndex(pointerY: number, rowEdges: number[]): number {
	return nearestEdgeIndex(pointerY, rowEdges);
}

export function columnDropIndex(pointerX: number, colEdges: number[]): number {
	return nearestEdgeIndex(pointerX, colEdges);
}
