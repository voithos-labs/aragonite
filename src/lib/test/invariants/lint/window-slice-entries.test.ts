/**
 * G4.271: a windowed list renders `windowSlicer`'s entries and hands each child the entry's own
 * index and id. An index added up from the live window start runs ahead of the loop's own index as
 * soon as a height write moves the window, so a size report read before the next render lands on
 * the wrong block.
 */

import { collectEditorSources } from './scan-source';
import { describeFileRules, svelteOnly } from './file-rule';
import type { SourceFile } from './scan-source';
import { SOURCE } from './source-paths';

const EACH_INDEX = /\{#each\s[^}]*?\bas\s+[^,}]+,\s*(\w+)/g;
const CONST_FROM_START = /\{@const\s+\w+\s*=\s*[\w.]*\bstart\s*\+/;

function addsToWindowStart(file: SourceFile): boolean {
	if (CONST_FROM_START.test(file.code)) return true;
	for (const [, index] of file.code.matchAll(EACH_INDEX)) {
		if (new RegExp(`\\bstart\\s*\\+\\s*${index}\\b`).test(file.code)) return true;
	}
	return false;
}

const svelteProbe = (code: string) => ({ relPath: 'Probe.svelte', code });

describeFileRules(
	[
		{
			id: 'G4.271 a windowed list indexes its children from its slice entries',
			population: svelteOnly,
			matches: addsToWindowStart,
			reason:
				'a component adds a loop index to a window start: loop over `windowSlicer`’s entries and pass each child `entry.index` and `entry.id`',
			reaches: [SOURCE.blockList, SOURCE.listBlock, SOURCE.tableBlock],
			hits: [
				svelteProbe('{#each slice as node, localIndex (ids[start + localIndex])}'),
				svelteProbe('{#each rows as row, i}{@const index = start + i}<Row {index} />{/each}'),
				svelteProbe('{#each items as item, j}<Item index={bounds.start + j} />{/each}'),
				svelteProbe('{@const rowIdx = bounds.start + localIndex}')
			],
			misses: [
				svelteProbe('{#each slice.entries as entry (entry.id)}{@const index = entry.index}'),
				svelteProbe('{#each lines as line, i}<span data-line={i}>{line}</span>{/each}'),
				svelteProbe('<script>const end = range.start + text.length;</script>')
			]
		}
	],
	collectEditorSources()
);
