// A paste into a fenced code block holding `display`, taken as far as the bytes the write would
// store: the code block's paste surface splices, and the write's rule makes the result legal.

import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { codePasteSurface } from '$lib/components/blocks/code/code-paste-surface';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { fixtureReading } from '../../harness/fixture-grammar';

export function pasteThroughWrite(input: {
	display: string;
	selection: { start: number; end: number };
	pasted: string;
}): { text: string; cursor: number } {
	const { display, selection, pasted } = input;
	const node = parse(`${display}\n`).children[0];
	const preDelete = selection.start === selection.end ? undefined : selection;
	const spliced = codePasteSurface.onInlinePaste!(
		node,
		selection.start,
		pasted,
		preDelete,
		fixtureReading(),
		'\n'
	);
	const target = { children: [node], owner: undefined, lineEnding: '\n' as const };
	const write = legalizeWrite(target, 0, spliced.newRaw, 'literal');
	return {
		text: trimTrailingLineEnding(write.text),
		cursor: write.storedOffset(spliced.caretOffset)
	};
}
