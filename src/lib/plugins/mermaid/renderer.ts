/**
 * The `mermaid`-backed renderer — the engine adapter reached through the
 * `aragonite/plugins/mermaid/renderer` subpath. It is the consumer half of the
 * injection seam: the plugin core stays engine-free, and passing this export as
 * `mermaidPlugin({ renderer: mermaidRenderer })` opts into the (optional-peer)
 * dependency. The dynamic import keeps the engine off module eval, so nothing
 * touches `document` until a diagram actually renders.
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

export const mermaidRenderer: MermaidRenderer = async (code, id) => {
	const mermaid = await loadMermaid();
	const { svg } = await mermaid.render(id, code);
	return svg;
};
