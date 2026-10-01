// A join's one-line read is trusted only where no block above the cut has a reading that isn't
// final (an unclosed `$$` left as a paragraph), since lines below can still complete it.
// Miss-analysis: the rows pinning the one-line read wrote under blocks whose reading ends at their
// own last line, so no row put a backed-out `$$` or `:::` above a block that later closes it.
import { describe, it, expect, beforeEach } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { installPlugins } from '$lib';
import {
	OPENER_PRIORITIES,
	registerBlockOpener,
	type BlockOpener,
	type BlockOpenerResult
} from '$lib/plugin';
import { parse } from '$lib/core/parser';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite, updateNodeContent } from '$lib/tree-operations/content-write';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence, expectParseConverged } from '$lib/test/harness/parse-converged';
import { testLeaf } from '$lib/test/harness/test-kinds';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createSharingState } from '$lib/tree-operations/sharing';
import { latexPlugin } from '$lib/plugins/latex';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';

/** The top-level kinds after `text` is written over block `index` through the keystroke route. */
function typedOverSecond(source: string, text: string, index = 1): string[] {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const write = legalizeWrite(deps.doc, index, text, 'authored');
	expect(typing.writeLeafInPlace(docPathFrom([index]), write, 0).wrote).toBe(true);
	expectParseConverged(deps.doc);
	return deps.doc.children.map((c) => c.kind);
}

describe('a construct backed out above a join completes once a write below closes it', () => {
	beforeEach(() => {
		installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
	});

	it.each([
		['a `$$` block', '$$\n<div>\nx\n', '<div>\n$$\n'],
		['a `:::note` block', ':::note\n<div>\nx\n', '<div>\n:::\n']
	])('%s backed out over a flush HTML block takes it in', (_label, source, text) => {
		expect(typedOverSecond(source, text)).toHaveLength(1);
	});

	// The construct reads on past blank lines for its closer, so the join above is asked across them.
	it.each([
		['a `$$` block', '$$\n\n<div>\nx\n', '<div>\n$$\n'],
		['a `:::note` block', ':::note\n\n<div>\nx\n', '<div>\n:::\n'],
		[
			'a `<details>` block',
			'<details>\n<summary>s</summary>\nx\n\n<div>\ny\n',
			'<div>\n</details>\n'
		]
	])('%s backed out a blank line above takes in the block that closes it', (_l, source, text) => {
		expect(typedOverSecond(source, text)).toHaveLength(1);
	});

	// `$$` cuts a paragraph off, so a backed-out one always starts a block: the first line is the
	// only line of the block above the check has to read.
	it('a `$$` typed under paragraph text starts its own block and takes in the closer below', () => {
		expect(typedOverSecond('p\n$$\n<div>\nx\n', '<div>\n$$\n', 2)).toEqual([
			'paragraph',
			'mathBlock'
		]);
	});
});

// ── What leaving the declaration out costs ───────────────────────────────────

/** A `fence`-bounded block that, unclosed, backs out to paragraphs, as `$$` does. */
function fencedOpener(kind: string, fence: string, declared: boolean): BlockOpener {
	const awaitsCloser = (raw: string) => {
		const [opener, ...rest] = raw.split('\n');
		return opener === fence && !rest.includes(fence);
	};
	return {
		priority: OPENER_PRIORITIES.fencedCode + 7,
		interruptsParagraph: (line) => line === fence,
		...(declared ? { readingNotFinal: awaitsCloser } : {}),
		tryOpen(ctx): BlockOpenerResult | null {
			if (ctx.line.text !== fence) return null;
			let close = ctx.index + 1;
			while (close < ctx.end && ctx.lines[close].text !== fence) close++;
			if (close >= ctx.end) return null;
			const raw = ctx.lines
				.slice(ctx.index, close + 1)
				.map((line) => line.raw)
				.join('');
			const node = { kind, leadingTrivia: ctx.leadingTrivia, raw } as CstNode;
			return { node, consumed: close + 1 - ctx.index };
		}
	};
}

describe('a backing-out opener that leaves its declaration out', () => {
	beforeEach(() => {
		registerBlockOpener(testLeaf('undeclared'), fencedOpener('undeclared', '%%%', false));
		registerBlockOpener(testLeaf('declared'), fencedOpener('declared', '@@@', true));
	});

	it('leaves its own shape two blocks where a reload reads one', () => {
		const doc = parse('%%%\n<div>\nx\n');
		updateNodeContent(doc, 1, '<div>\n%%%\n', defaultGrammarView, createSharingState());

		expect(describeConvergence(doc)).toBe('[] live has 2 children, reparsed has 1');
	});

	it('and nothing else: the same write converges once the opener declares it', () => {
		expect(typedOverSecond('@@@\n<div>\nx\n', '<div>\n@@@\n')).toEqual(['declared']);
		expect(typedOverSecond('foo\n<div>\n', '<span>\n')).toEqual(['paragraph']);
	});
});
