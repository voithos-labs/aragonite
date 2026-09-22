// The names every editable block and whole-block input carry for a screen reader, and the noun
// the block menu builds its rows from.
// Miss-analysis: axe's unnamed-textbox rule sat in the allowlist, so no test read a block's name.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { NodeView } from '$lib/core/node-views';
import { blockAccessibleName, blockKindLabel } from '$lib/a11y-strings';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { testClosure } from './support/closure';

const first = (md: string): NodeView => parse(md).children[0];

describe('blockAccessibleName', () => {
	it('names a heading by its level, whichever syntax wrote it', () => {
		expect(blockAccessibleName(first('### Title\n'))).toBe('Heading level 3');
		expect(blockAccessibleName(first('Title\n---\n'))).toBe('Heading level 2');
	});

	it('adds a code fence’s language when the info string names one', () => {
		expect(blockAccessibleName(first('```ts title\nx\n```\n'))).toBe('Code block, ts');
		expect(blockAccessibleName(first('```\nx\n```\n'))).toBe('Code block');
	});

	it('names the rest by kind alone', () => {
		expect(blockAccessibleName(first('text\n'))).toBe('Paragraph');
		expect(blockAccessibleName(first('***\n'))).toBe('Divider');
	});
});

describe('blockKindLabel for plugin kinds', () => {
	it('reads the descriptor’s label', () => {
		const kind = declarePluginKind('labelledWidget');
		registerBlockKind(kind, {
			label: 'Chart',
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure
		});
		expect(blockKindLabel(kind)).toBe('Chart');
	});

	it('falls back to the kind name in words', () => {
		expect(blockKindLabel(declarePluginKind('mysteryWidget'))).toBe('Mystery widget');
		expect(blockKindLabel(declarePluginKind('details-summary'))).toBe('Details summary');
	});
});
