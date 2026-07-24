/**
 * PasteSurface for fenced code blocks. Paste is always literal text, so the
 * structural hook is omitted — pasteDispatch falls through to the inline path
 * and computeCodePaste handles the fence-bump invariant.
 */

import { metadataOf } from '../../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';
import type { PasteSurface, InlinePasteResult } from '../../../tree-operations/paste-surfaces';
import { computeCodePaste } from './code-paste';

export const codePasteSurface: PasteSurface = {
	kind: 'fencedCode',
	onInlinePaste(node, offset, text, preDelete): InlinePasteResult {
		const meta = metadataOf(node, 'fencedCode');
		const lineEnding = trailingLineEnding(node.raw);
		const display = trimTrailingLineEnding(node.raw);

		const start = preDelete?.start ?? offset;
		const end = preDelete?.end ?? offset;

		const result = computeCodePaste({
			display,
			selection: { start, end },
			pasted: text,
			fenceMarker: meta.fenceMarker,
			fenceLength: meta.fenceLength,
			closed: meta.closed
		});

		return {
			newRaw: result.text + lineEnding,
			caretOffset: result.cursor
		};
	}
};
