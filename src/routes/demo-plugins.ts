import { admonitions } from '@voithos-labs/aragonite-admonitions';
import { highlight } from '@voithos-labs/aragonite-highlight';
import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';
import { details } from '@voithos-labs/aragonite-details';
import { toc } from '@voithos-labs/aragonite-toc';
import { footnotes } from '@voithos-labs/aragonite-footnotes';
import { emoji } from '@voithos-labs/aragonite-emoji';
import { highlightOccurrences } from '@voithos-labs/aragonite-highlight-occurrences';
import { latex } from '@voithos-labs/aragonite-latex';
import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';
import { mermaid } from '@voithos-labs/aragonite-mermaid';
import { parrotPlugin } from '@voithos-labs/aragonite-parrot';
import { mermaidRenderer } from '@voithos-labs/aragonite-mermaid/renderer';
import { slashCommands } from '@voithos-labs/aragonite-slash-commands';
import { tagMarks } from '../../examples/showcase/tag-marks';

// The one place the demo routes create their plugins: definitions are process-global and the
// first install wins, so a route that wants different options passes `{ plugin, options }` rather
// than its own array. Exported one by one as well as in a set, since a route may install a few.
export const DEMO_ADMONITIONS = admonitions;
export const DEMO_DETAILS = details;
export const DEMO_TOC = toc;
export const DEMO_FOOTNOTES = footnotes;
export const DEMO_EMOJI = emoji;
export const DEMO_HIGHLIGHT_OCCURRENCES = highlightOccurrences;
export const DEMO_LATEX = latex({ renderer: katexRenderer });
export const DEMO_MERMAID = mermaid({ renderer: mermaidRenderer });
export const DEMO_HIGHLIGHT = highlight({ renderer: highlightJs() });
export const DEMO_PARROT = parrotPlugin();
// Opt-in for a consumer; the showcase opts in, so `/` lists the blocks there.
export const DEMO_SLASH_COMMANDS = slashCommands;
// Tags as mark decorations over plain text, so a tag keeps every text gesture. Kept out of
// `DEMO_PLUGINS`, the tour of the bundled plugins; the showcase installs it on its own.
export const DEMO_TAGS = tagMarks;

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
	DEMO_SLASH_COMMANDS,
	DEMO_HIGHLIGHT
];
