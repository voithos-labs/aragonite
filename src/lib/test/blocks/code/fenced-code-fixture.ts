// The fencedCode CST node the code suites assert against, built from its raw bytes.
import type { CstNode } from '$lib/core/nodes';

/** The fence shape a raw string cannot be read for: what the parser recorded about it. */
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
