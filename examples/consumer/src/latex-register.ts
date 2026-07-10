// Inline `$…$` math only. The block-math component is dogfood for the post-1.0
// editable-leaf tier and does not cross the package boundary. Lives here, outside
// the sync-wiped src/plugins/, so it survives every `sync-consumer-plugins` run.
import { definePlugin, type EditorPlugin } from 'aragonite/plugin';
import { registerMathInline } from './plugins/latex/latex-kind';

export function latexInlinePlugin(): EditorPlugin {
	return definePlugin({
		name: 'latex-inline',
		setup() {
			registerMathInline();
		}
	});
}
