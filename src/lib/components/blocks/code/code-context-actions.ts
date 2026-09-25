/**
 * The code block's context menu: dissolve the fence into plain text. Delete is every block's
 * default row. Registered once from the code bootstrap.
 */
import { registerBuiltinBlockContextActions } from '../../../schema/context-actions';
import { firstLineEnding, trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';
import { sliceFencedCode } from './code-renderer';

let registered = false;

export function registerCodeContextActions(): void {
	if (registered) return;
	registered = true;
	registerBuiltinBlockContextActions('fencedCode', 'code', (node) => [
		{
			id: 'code.dissolve',
			label: 'Dissolve into text',
			icon: 'type',
			run: (ctx) => {
				// The body's lines as prose; the fence lines go. An empty body leaves an empty line.
				const body = trimTrailingLineEnding(sliceFencedCode(node).body);
				// The fence spans lines, so its bytes hold the document's ending; a lone opener
				// with no break at all falls back to LF.
				const ending = trailingLineEnding(node.raw, firstLineEnding(node.raw) ?? '\n');
				return ctx.replaceRaw(body + ending);
			}
		}
	]);
}
