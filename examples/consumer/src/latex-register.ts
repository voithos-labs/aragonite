// Inline `$…$` math only. The block-math component is dogfood for the post-1.0
// editable-leaf tier and does not cross the package boundary. Lives here, outside
// the sync-wiped src/plugins/, so it survives every `sync-consumer-plugins` run.
import { registerMathInline } from './plugins/latex/latex-kind';

export function registerLatexInline(): void {
	registerMathInline();
}
