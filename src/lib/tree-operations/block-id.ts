/**
 * Block ID minting for keyed rendering and focus management.
 */

import type { CstNode } from '../core/nodes';

export function generateBlockId(): string {
	return crypto.randomUUID();
}

export function assignIds(children: CstNode[]): string[] {
	return children.map(() => generateBlockId());
}
