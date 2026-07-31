/**
 * The engine adapter behind the `aragonite/plugins/mermaid/renderer` subpath, the
 * consumer half of the injection seam. The dynamic import keeps the engine off module
 * eval, so nothing touches `document` until a diagram actually renders.
 */

import type { MermaidConfig } from 'mermaid';
import type { MermaidRenderer } from './mermaid-renderer';

type MermaidTheme = NonNullable<MermaidConfig['theme']>;

/** Respread on every re-initialize, because mermaid's `initialize` replaces the site
 *  config rather than patching it. */
const BASE_CONFIG: MermaidConfig = {
	startOnLoad: false,
	securityLevel: 'strict',
	// A parse failure must reject the promise so the plugin renders the legible error,
	// rather than inject mermaid's own error SVG into the DOM.
	suppressErrorRendering: true
};

const MERMAID_THEMES = new Set<string>(['default', 'base', 'dark', 'forest', 'neutral']);

/**
 * Mermaid's own names pass through, so a consumer can name its editor theme `'forest'`
 * and get it; anything else falls to mermaid's light palette. To map a custom theme,
 * wrap this renderer: it is injected, so rewriting `context.theme` is the seam.
 */
function toMermaidTheme(editorTheme: string): MermaidTheme {
	return (MERMAID_THEMES.has(editorTheme) ? editorTheme : 'default') as MermaidTheme;
}

let engine: Promise<typeof import('mermaid').default> | null = null;
let configuredTheme: MermaidTheme | null = null;
let queue: Promise<unknown> = Promise.resolve();

function loadMermaid(): Promise<typeof import('mermaid').default> {
	if (!engine) engine = import('mermaid').then(({ default: mermaid }) => mermaid);
	return engine;
}

async function renderThemed(code: string, id: string, theme: MermaidTheme): Promise<string> {
	const mermaid = await loadMermaid();
	// `render(id, text)` takes no config argument, so re-initializing is the only way a
	// theme reaches a render. A `%%{init}%%` prepend would avoid the global write but
	// corrupt any diagram carrying YAML front matter, which must start at byte 0.
	if (theme !== configuredTheme) {
		mermaid.initialize({ ...BASE_CONFIG, theme });
		configuredTheme = theme;
	}
	const { svg } = await mermaid.render(id, code);
	return svg;
}

/**
 * Chained, not concurrent: the site config is process-global, so two renders
 * straddling a theme flip would interleave and one diagram would come back
 * half-themed. Mermaid's own `run()` is sequential for the same reason.
 */
export const mermaidRenderer: MermaidRenderer = (code, id, context) => {
	const theme = toMermaidTheme(context?.theme ?? 'dark');
	const svg = queue.then(() => renderThemed(code, id, theme));
	// The chain must survive a rejection, or one bad diagram strands every later render.
	queue = svg.then(
		() => {},
		() => {}
	);
	return svg;
};
