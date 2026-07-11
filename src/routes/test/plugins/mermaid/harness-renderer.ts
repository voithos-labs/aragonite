/**
 * Harness-side renderer backed by the `mermaid` package — the consumer half of
 * the injection seam, deliberately OUTSIDE the plugin's sync manifest (a real
 * consumer supplies its own). The dynamic import keeps the engine off module
 * eval, so nothing touches `document` until a diagram actually renders
 * (client-only by construction — the component renders through effects).
 */

import type { MermaidRenderer } from './mermaid-renderer';

let engine: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
	if (!engine) {
		engine = import('mermaid').then(({ default: mermaid }) => {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				// A parse failure must reject the promise (the plugin renders the
				// legible error), not inject mermaid's own error SVG into the DOM.
				suppressErrorRendering: true
			});
			return mermaid;
		});
	}
	return engine;
}

export const mermaidHarnessRenderer: MermaidRenderer = async (code, id) => {
	const mermaid = await loadMermaid();
	const { svg } = await mermaid.render(id, code);
	return svg;
};
