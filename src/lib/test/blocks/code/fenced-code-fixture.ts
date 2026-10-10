// The fencedCode CST node the code suites assert against, built from its raw bytes.
import type { CstNode } from '#lib/core/nodes.js';

/** What the parser records about a fence that the fixture does not read from the raw. */
export interface FenceShape {
	closed: boolean;
	fenceMarker: '`' | '~';
	fenceLength: number;
}

export function fencedCode(raw: string, info = '', shape: Partial<FenceShape> = {}): CstNode {
	return {
		kind: 'fencedCode',
		leadingTrivia: '',
		raw,
		metadata: { fenceMarker: '`', fenceLength: 3, closed: true, ...shape, info }
	};
}
