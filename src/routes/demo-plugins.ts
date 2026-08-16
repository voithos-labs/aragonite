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

// One mint site for every demo route: definitions are process-global and install first-wins, so a
// route varying a plugin's configuration passes `{ plugin, options }` rather than its own array.
// Exported unit by unit as well as in a set, because a route may install a subset.
export const DEMO_ADMONITIONS = admonitionsPlugin();
export const DEMO_DETAILS = detailsPlugin();
export const DEMO_TOC = tocPlugin();
export const DEMO_FOOTNOTES = footnotesPlugin();
export const DEMO_EMOJI = emojiPlugin();
export const DEMO_HIGHLIGHT_OCCURRENCES = highlightOccurrencesPlugin();
export const DEMO_LATEX = latexPlugin({ renderer: katexRenderer });
export const DEMO_MERMAID = mermaidPlugin({ renderer: mermaidRenderer });

export const DEMO_PLUGINS = [
	DEMO_ADMONITIONS,
	DEMO_DETAILS,
	DEMO_TOC,
	DEMO_FOOTNOTES,
	DEMO_EMOJI,
	DEMO_HIGHLIGHT_OCCURRENCES,
	DEMO_LATEX,
	DEMO_MERMAID
];
