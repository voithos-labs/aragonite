import type { SiblingList, ListResult } from './types';

export function withOneBlock(list: SiblingList): ListResult {
	if (list.children.length > 0) return { at: 0, removed: 0, blocks: [], keeps: [] };
	return {
		at: 0,
		removed: 0,
		blocks: [{ kind: 'paragraph', leadingTrivia: '', raw: list.lineEnding }],
		keeps: [-1]
	};
}
