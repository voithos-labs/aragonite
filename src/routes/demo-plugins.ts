import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';
import { tocPlugin } from '$lib/plugins/toc';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { katexRenderer } from '$lib/plugins/latex/renderer';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { parrotPlugin } from '$lib/plugins/parrot';
import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';
import { tagMarksPlugin } from './demo-tags/tag-marks-plugin';

// The one place the demo routes create their plugins: definitions are process-global and the
// first install wins, so a route that wants different options passes `{ plugin, options }` rather
// than its own array. Exported one by one as well as in a set, since a route may install a few.
export const DEMO_ADMONITIONS = admonitionsPlugin();
export const DEMO_DETAILS = detailsPlugin();
export const DEMO_TOC = tocPlugin();
export const DEMO_FOOTNOTES = footnotesPlugin();
export const DEMO_EMOJI = emojiPlugin();
export const DEMO_HIGHLIGHT_OCCURRENCES = highlightOccurrencesPlugin();
export const DEMO_LATEX = latexPlugin({ renderer: katexRenderer });
export const DEMO_MERMAID = mermaidPlugin({ renderer: mermaidRenderer });
export const DEMO_PARROT = parrotPlugin();
// `#tag` inside the text, as mark decorations over ordinary characters: the tag keeps every
// gesture the browser gives text, and is nowhere a widget. Kept out of `DEMO_PLUGINS`, the tour
// of the bundled plugins; the showcase installs this one on its own.
export const DEMO_TAGS = tagMarksPlugin();

export const DEMO_PLUGINS = [
	DEMO_ADMONITIONS,
	DEMO_DETAILS,
	DEMO_TOC,
	DEMO_FOOTNOTES,
	DEMO_EMOJI,
	DEMO_HIGHLIGHT_OCCURRENCES,
	DEMO_LATEX,
	DEMO_MERMAID,
	DEMO_PARROT
];
