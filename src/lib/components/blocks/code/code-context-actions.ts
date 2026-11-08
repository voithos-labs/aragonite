/**
 * The code block's own context-menu row: dissolve the fence into plain text. Copy, replace and
 * remove are every block's rows.
 */
import { trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';
import type { NodeView } from '../../../core/node-views';
import type { BlockContextAction } from '../../menu/default-context-actions';
import { sliceFencedCode } from './code-renderer';

export function codeBlockActions(node: NodeView): BlockContextAction[] {
	return [
		{
			id: 'code.dissolve',
			label: 'Dissolve into text',
			icon: 'type',
			run: (ctx) => {
				// The body's lines as prose; the fence lines go. An empty body leaves an empty line.
				const body = trimTrailingLineEnding(sliceFencedCode(node).body);
				return ctx.replaceRaw(body + trailingLineEnding(node.raw, ctx.lineEnding));
			}
		}
	];
}
