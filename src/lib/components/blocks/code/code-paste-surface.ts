/**
 * PasteSurface for fenced code blocks. All paste into a code block is
 * treated as literal text; the structural hook is intentionally omitted
 * so pasteDispatch falls through to the inline path.
 *
 * The inline hook delegates to computeCodePaste, which handles the
 * fence-bump invariant (outer fence grows one longer than the longest
 * fence run in the paste, so pasted backtick/tilde runs stay literal
 * inside the block).
 */

import type { FencedCodeMetadata } from '../../../core/nodes';
import type { PasteSurface, InlinePasteResult } from '../../../tree-operations/paste-surfaces';
import { computeCodePaste } from './code-paste';

export const codePasteSurface: PasteSurface = {
	kind: 'fencedCode',
	onInlinePaste(node, offset, text, preDelete): InlinePasteResult {
		const meta = node.metadata as FencedCodeMetadata;
		const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';
		const display = node.raw.endsWith(lineEnding)
			? node.raw.slice(0, -lineEnding.length)
			: node.raw;

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
