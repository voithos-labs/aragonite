/**
 * FocusActions factory: cursor movement across blocks, including
 * sticky-column-aware vertical traversal and trailing-paragraph creation
 * past the document end.
 */

import { tick } from 'svelte';
import {
	CURSOR_END,
	type FocusActions,
	type FocusPosition,
	type CstNode
} from '../../contracts';
import { generateBlockId } from '../../tree-operations/block-id';
import type { EditorActionsDeps } from './deps';

export function createFocusActions(deps: EditorActionsDeps): FocusActions {
	return {
		async moveFocus(blockIndex: number, position: FocusPosition): Promise<void> {
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				// Past the last block — create a new empty paragraph
				const newBlock: CstNode = { kind: 'paragraph', leadingTrivia: '\n', raw: '\n' };
				deps.setDocChildren([...deps.doc.children, newBlock]);
				deps.setBlockIds([...deps.blockIds, generateBlockId()]);
				deps.setBlockRefs([...deps.blockRefs, undefined]);
				await tick();
				deps.blockRefs[deps.doc.children.length - 1]?.focus(0);
				return;
			}
			const block = deps.blockRefs[blockIndex];
			if (!block?.focusable) return;

			if (typeof position === 'object' && 'stickyColumnFrom' in position) {
				// Sticky-column variant: dispatch to focusAtColumn? if available,
				// else fall back to focus(0) / focus(CURSOR_END) based on direction.
				const x = deps.stickyColumn.get();
				const from = position.stickyColumnFrom;
				if (x !== null && block.focusAtColumn) {
					block.focusAtColumn(x, from);
					return;
				}
				block.focus(from === 'above' ? 0 : CURSOR_END);
				return;
			}

			if (typeof position === 'number') {
				block.focus(position);
			} else if (position === 'start') {
				block.focus(0);
			} else {
				// 'end' — use a large number, focus() should clamp to content length
				block.focus(CURSOR_END);
			}
		}
	};
}
