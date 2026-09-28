// Miss-analysis: emptiness routes were tested with spaces or nothing, never a non-breaking space.
import { describe, expect, it, vi, type Mocked } from 'vitest';
import type { ListContext } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { getInlineContent } from '$lib/core/inline/inline-cache';
import { isVerticallyTransparentNode } from '$lib/core/inline/transparency';
import { createContainerExitOverrides } from '$lib/editor-actions/container-exit-overrides';
import { createListItemOverrides } from '$lib/editor-actions/list-overrides';
import type { NestedActionsBundle } from '$lib/editor-actions/nested/nested-actions';
import {
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextAfter,
	rawHasNoTextBefore
} from '$lib/components/blocks/text/widget-adjacency';
import { isItemUserEmpty } from '$lib/tree-operations/list/empty-check';
import { lacksSublistSeparator } from '$lib/tree-operations/list/sublist-separator';
import { findContainerMatchingUnwrap } from '$lib/tree-operations/paste/container-match';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { makeStubBlockEdit, makeStubFocus } from '$lib/test/harness/editor-actions';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

const NBSP = String.fromCharCode(0xa0);

// ── Enter in a container ─────────────────────────────────────────────────────

describe('Enter at the end of a block holding a non-breaking space', () => {
	it('splits inside a blockquote instead of leaving it', async () => {
		const quote = parse(`> a\n>\n> ${NBSP}\n`).children[0];
		const last = quote.children!.length - 1;
		const parentBlockEdit = makeStubBlockEdit();
		const defaults = { blockEdit: makeStubBlockEdit(), focus: makeStubFocus() };
		const overrides = createContainerExitOverrides({
			scope: { index: 0, node: quote, path: [0] },
			parentBlockEdit,
			reading: fixtureReading()
		})({ ...defaults, containerEdit: {} as never });

		await overrides.blockEdit!.splitBlock!(last, 1);

		expect(parentBlockEdit.replaceBlock).not.toHaveBeenCalled();
		expect(parentBlockEdit.splitBlock).not.toHaveBeenCalled();
		expect(defaults.blockEdit.splitBlock).toHaveBeenCalledWith(last, 1);
	});

	it('starts the next list item instead of leaving the list', async () => {
		const item = parse(`- ${NBSP}\n`).children[0].children![0];
		const listContext = {
			insertItemAfter: vi.fn(async () => {}),
			exitListAtItem: vi.fn(async () => {}),
			splitItemAtOffset: vi.fn(async () => {})
		} as unknown as Mocked<ListContext>;
		const overrides = createListItemOverrides({
			scope: { index: 0, node: item, path: [0, 0] },
			listContext
		})({} as NestedActionsBundle);

		await overrides.blockEdit!.splitBlock!(0, 1);

		expect(listContext.exitListAtItem).not.toHaveBeenCalled();
		expect(listContext.insertItemAfter).toHaveBeenCalledWith(0);
	});
});

// ── Tree reads that decide on emptiness ─────────────────────────────────────

describe('a non-breaking space counts as content to', () => {
	it('the list item emptiness Backspace and Enter share', () => {
		const item = (source: string) => parse(source).children[0].children![0];
		expect(isItemUserEmpty(item(`- ${NBSP}\n`))).toBe(false);
		expect(isItemUserEmpty(item('- \n'))).toBe(true);
	});

	it('the sublist separator, which a paragraph above needs', () => {
		const children = (above: string): CstNode[] => [
			parse(above).children[0],
			parse('- \n').children[0]
		];
		expect(lacksSublistSeparator(children(`${NBSP}\n`), 1)).toBe(true);
		expect(lacksSublistSeparator(children('x\n'), 1)).toBe(true);
	});

	it('a container-matching paste, which replaces an empty target outright', () => {
		const doc = parse(`> a\n>\n> ${NBSP}\n`);
		const target = [0, doc.children[0].children!.length - 1];
		expect(findContainerMatchingUnwrap(doc, target, 0, parse('> X\n'), false)).toBeNull();
	});

	it('vertical traversal, which skips an image-only block', () => {
		const block = (source: string) => parse(source).children[0];
		expect(isVerticallyTransparentNode(block(`![a](u)${NBSP}\n`), defaultGrammarView)).toBe(false);
		expect(isVerticallyTransparentNode(block('![a](u) \n'), defaultGrammarView)).toBe(true);
	});

	it('the widget edge reads', () => {
		const raw = `${NBSP}![a](u)${NBSP}`;
		const inlines = getInlineContent(
			{ kind: 'paragraph', leadingTrivia: '', raw },
			undefined,
			'',
			defaultGrammarView
		);
		expect(findFirstEdgeWidget(inlines, raw, defaultGrammarView)).toBeNull();
		expect(findLastEdgeWidget(inlines, raw, defaultGrammarView)).toBeNull();
		expect(rawHasNoTextBefore(raw, 1)).toBe(false);
		expect(rawHasNoTextAfter(raw, raw.length - 1)).toBe(false);
		expect(rawHasNoTextBefore(' \t', 2)).toBe(true);
	});
});
