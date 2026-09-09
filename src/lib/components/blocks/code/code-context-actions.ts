/**
 * The code block's context menu: dissolve the fence into plain text. Delete is every block's
 * default row. Registered once from the code bootstrap.
 */
import { registerBlockContextActions } from '../../../schema/context-actions';
import { sliceFencedCode } from './code-renderer';

let registered = false;

export function registerCodeContextActions(): void {
	if (registered) return;
	registered = true;
	registerBlockContextActions('fencedCode', (node) => [
		{
			id: 'code.dissolve',
			label: 'Dissolve into text',
			icon: 'type',
			run: (ctx) => {
				// The body's lines as prose; the fence lines go. An empty body leaves an empty line.
				const body = sliceFencedCode(node).body.replace(/\r?\n$/, '');
				return ctx.replaceRaw(body + '\n');
			}
		}
	]);
}
