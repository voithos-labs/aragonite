/**
 * The mermaid adapter behind the `@voithos-labs/aragonite/plugins/mermaid/renderer` subpath,
 * the half a consumer supplies. The dynamic import keeps mermaid out of module evaluation, so
 * nothing touches `document` until a diagram actually renders.
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
 * Mermaid's own names pass through, so a consumer can name its editor theme `'forest'` and
 * get it; anything else falls to mermaid's light palette. Wrapping this renderer to rewrite
 * `context.theme` is how a custom theme maps onto one of mermaid's.
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
	// `render(id, text)` takes no config argument, so re-initializing is the only way a theme
	// reaches a render without prepending `%%{init}%%`, which front matter forbids.
	if (theme !== configuredTheme) {
		mermaid.initialize({ ...BASE_CONFIG, theme });
		configuredTheme = theme;
	}
	const { svg } = await mermaid.render(id, code);
	return svg;
}

/**
 * One after another, not together: the config is global to the process, so two renders either
 * side of a theme change would interleave and one diagram would come back half-themed.
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
