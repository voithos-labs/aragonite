import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';
import { tocPlugin } from '$lib/plugins/toc';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { katexRenderer } from '$lib/plugins/latex/renderer';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';

// One mint site for every demo route: definitions are process-global and install first-wins,
// so per-route arrays silently ignore the loser's options (toc depth is the shipped case, #64).
export const DEMO_PLUGINS = [
	admonitionsPlugin(),
	detailsPlugin(),
	tocPlugin(),
	footnotesPlugin(),
	emojiPlugin(),
	highlightOccurrencesPlugin(),
	latexPlugin({ renderer: katexRenderer }),
	mermaidPlugin({ renderer: mermaidRenderer })
];
