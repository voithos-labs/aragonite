// Shared scaffolding for the widget-reveal unit suites (reveal-commit,
// reveal-collapse). The stamped wrapper is a faithful stand-in for the render
// layer's portal island: the interaction layer reads only the marker attributes
// and the source text between flanking prose. Mounting the real MathInline
// (Svelte + KaTeX) is the e2e's job.
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import type { InlineNode } from '$lib/core/nodes';

export function stampMathWidget(node: InlineNode): HTMLElement {
	const wrapper = document.createElement('span');
	wrapper.dataset.inlineWidget = '';
	wrapper.dataset.sourceStart = String(node.start);
	wrapper.dataset.sourceEnd = String(node.end);
	wrapper.setAttribute('contenteditable', 'false');
	wrapper.textContent = 'x';
	return wrapper;
}

export function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}
