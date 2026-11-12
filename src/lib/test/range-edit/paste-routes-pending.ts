// The paste route rows that wait for a ruling, each keyed to its row in the lane's delta table. A
// row here must disagree with the core: once it agrees, the route table reds until it leaves.

/** Route-table row key to the delta-table row that holds it. */
export const PENDING_PASTE_ROWS: Readonly<Record<string, string>> = {};
