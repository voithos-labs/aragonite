// The editable surface's clipboard half, built from the parts it reads, for a test that drives one
// block's clipboard without mounting a surface.

import type { BlockEditActions } from '#lib/action-contracts.js';
import {
	createClipboardHandlers,
	pasteIntoBlock,
	type SurfaceClipboardContext
} from '#lib/components/blocks/editable/surface-clipboard.js';
import type { TextClipboardDeps } from '#lib/components/blocks/text/text-clipboard.js';
import type { PasteCommitCoordinator } from '#lib/tree-operations/paste/paste-deps.js';
import type { PluginActivation } from '#lib/schema/plugin-activation.js';
import type { Reading } from '#lib/schema/reading.js';
import type { RawRange } from '#lib/browser/offsets.js';
import { blockRangeClipboard } from '#lib/selection/range-clipboard.js';

export interface ClipboardSurfaceParts extends Omit<SurfaceClipboardContext, 'copyRange'> {
	blockEdit: BlockEditActions;
	pasteCoordinator: PasteCommitCoordinator;
	activePlugins: PluginActivation;
	readonly reading: Reading;
	readonly myPath: number[];
	setPendingCursor: (offset: number | null) => void;
}

/** Fields are read at each call, so a getter on `parts` stays live. */
export function clipboardSurface(parts: ClipboardSurfaceParts): TextClipboardDeps['surface'] {
	// The surface's own copy: the block's range read through the document, as the editor reads it.
	const copyRange = (range: RawRange) =>
		blockRangeClipboard(parts.getDoc(), parts.myPath, range, parts.reading);
	return {
		get caret() {
			return parts.caret;
		},
		get blockEdit() {
			return parts.blockEdit;
		},
		copyRange,
		clipboard: (block) => createClipboardHandlers({ ...parts, ...block, copyRange }),
		pasteInline: (paste) =>
			pasteIntoBlock(
				{
					getMyPath: () => parts.myPath,
					getDoc: parts.getDoc,
					blockEdit: parts.blockEdit,
					controller: parts.pasteCoordinator,
					reading: parts.reading,
					activePlugins: parts.activePlugins,
					requestCaret: (at) => parts.setPendingCursor(at)
				},
				paste
			)
	};
}
