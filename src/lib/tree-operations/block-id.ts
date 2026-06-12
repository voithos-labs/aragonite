import type { CstNode } from '../core/nodes';

export function generateBlockId(): string {
	return crypto.randomUUID();
}

export function assignIds(children: CstNode[]): string[] {
	return children.map(() => generateBlockId());
}

/** Fresh ids for a freshly-built children array (builders constructing new containers). */
export function freshChildIds(children: CstNode[]): string[] {
	return assignIds(children);
}
