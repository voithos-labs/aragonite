/**
 * PasteSurface for fenced code blocks. Paste is always literal text, so the structural hook is
 * omitted and pasteDispatch falls through to the inline path; the write that stores the splice
 * runs the fence rule, which grows the fence past a run the paste lands.
 */

import { trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';
import type { PasteSurface, InlinePasteResult } from '../../../tree-operations/paste-surfaces';

export const codePasteSurface: PasteSurface = {
	kind: 'fencedCode',
	onInlinePaste(node, offset, text, preDelete, _store, documentEnding): InlinePasteResult {
		const display = trimTrailingLineEnding(node.raw);
		const start = preDelete?.start ?? offset;
		return {
			newRaw:
				display.slice(0, start) +
				text +
				display.slice(preDelete?.end ?? offset) +
				trailingLineEnding(node.raw, documentEnding),
			caretOffset: start + text.length
		};
	}
};
