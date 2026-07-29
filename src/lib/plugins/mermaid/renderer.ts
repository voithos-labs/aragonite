/**
 * The `mermaid`-backed renderer — the engine adapter reached through the
 * `aragonite/plugins/mermaid/renderer` subpath. It is the consumer half of the
 * injection seam: the plugin core stays engine-free, and passing this export as
 * `mermaidPlugin({ renderer: mermaidRenderer })` opts into the (optional-peer)
 * dependency. The dynamic import keeps the engine off module eval, so nothing
 * touches `document` until a diagram actually renders.
 */

import type { MermaidConfig } from 'mermaid';
import type { MermaidRenderer } from './mermaid-renderer';

type MermaidTheme = NonNullable<MermaidConfig['theme']>;

/** Config the diagrams share regardless of theme. Respread on every re-initialize:
 *  mermaid's `initialize` REPLACES the site config rather than patching it. */
const BASE_CONFIG: MermaidConfig = {
	startOnLoad: false,
	securityLevel: 'strict',
	// A parse failure must reject the promise (the plugin renders the legible
	// error), not inject mermaid's own error SVG into the DOM.
	suppressErrorRendering: true
};

const MERMAID_THEMES = new Set<string>(['default', 'base', 'dark', 'forest', 'neutral']);

/**
 * Editor theme name → mermaid theme. Mermaid's own names pass through, so a consumer
 * can name its editor theme `'forest'` and get it; anything else falls to `'default'`,
 * mermaid's light palette. To map a custom theme differently, wrap this renderer —
 * it is injected, so a one-line adapter that rewrites `context.theme` is the seam.
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
	// v11's `render(id, text)` takes no config argument, and the theme is not a
	// `secure` key, so re-initializing is how a theme reaches a render: it replaces
	// the site config, which each render reads afresh. A `%%{init}%%` prepend would
	// avoid the global write but corrupt any diagram carrying YAML front matter,
	// which must start at byte 0.
	if (theme !== configuredTheme) {
		mermaid.initialize({ ...BASE_CONFIG, theme });
		configuredTheme = theme;
	}
	const { svg } = await mermaid.render(id, code);
	return svg;
}

/**
 * Renders are chained, not concurrent. The site config above is process-global, so
 * two renders straddling a theme flip would otherwise interleave and one diagram
 * would come back half-themed; mermaid's own `run()` is sequential for the same
 * reason. The plugin's memo means each (theme, code) pair reaches here at most once.
 */
export const mermaidRenderer: MermaidRenderer = (code, id, context) => {
	const theme = toMermaidTheme(context?.theme ?? 'dark');
	const svg = queue.then(() => renderThemed(code, id, theme));
	// The chain must survive a rejection, or one bad diagram would strand every
	// later render on a settled-rejected link.
	queue = svg.then(
		() => {},
		() => {}
	);
	return svg;
};
