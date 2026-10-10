import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';
import { tocPlugin } from '#lib/plugins/toc/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { emojiPlugin } from '#lib/plugins/emoji/index.js';
import { highlightOccurrencesPlugin } from '#lib/plugins/highlight-occurrences/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { katexRenderer } from '#lib/plugins/latex/renderer.js';
import { mermaidPlugin } from '#lib/plugins/mermaid/index.js';
import { parrotPlugin } from '#lib/plugins/parrot/index.js';
import { mermaidRenderer } from '#lib/plugins/mermaid/renderer.js';
import { slashCommandsPlugin } from '#lib/plugins/slash-commands/index.js';
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
// Opt-in for a consumer; the showcase opts in, so `/` lists the blocks there.
export const DEMO_SLASH_COMMANDS = slashCommandsPlugin();
// Tags as mark decorations over plain text, so a tag keeps every text gesture. Kept out of
// `DEMO_PLUGINS`, the tour of the bundled plugins; the showcase installs it on its own.
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
	DEMO_PARROT,
	DEMO_SLASH_COMMANDS
];
