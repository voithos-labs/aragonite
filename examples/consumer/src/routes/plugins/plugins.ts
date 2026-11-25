// The /plugins route's plugin list, kept importable so the library's own suite reads the seed with
// the list the route runs (`consumer-route-grammar.test.ts`). `own` is the route's own plugin, the
// guide's walkthrough synced into this app.
import type { Plugin } from '@voithos-labs/aragonite/plugin';
import { details } from '@voithos-labs/aragonite-details';
import { admonitions } from '@voithos-labs/aragonite-admonitions';
import { latex } from '@voithos-labs/aragonite-latex';
import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';
import { mermaid } from '@voithos-labs/aragonite-mermaid';
import { toc } from '@voithos-labs/aragonite-toc';
import { highlightOccurrences } from '@voithos-labs/aragonite-highlight-occurrences';
import { emoji } from '@voithos-labs/aragonite-emoji';
import { footnotes } from '@voithos-labs/aragonite-footnotes';
import { highlight } from '@voithos-labs/aragonite-highlight';
import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';

export const routePlugins = (own: Plugin) => [
	own,
	details,
	admonitions,
	latex({ renderer: katexRenderer }),
	// No renderer: the consumer wires no mermaid engine, so this exercises the packaged plugin's
	// no-engine fallback from outside the repo.
	mermaid,
	toc,
	highlightOccurrences,
	// Trigger bytes shared with the seed's `:::name` and `[[toc]]`: listed here to prove the readings
	// coexist rather than contest a claim.
	emoji,
	footnotes,
	highlight({ renderer: highlightJs() })
];
