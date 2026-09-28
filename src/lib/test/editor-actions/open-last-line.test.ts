// Miss-analysis (GH #635, #616): each route kept the open last line by hand or not at all, and
// every route's own suite ended its fixtures in a line break, so no route was ever run as a class.

import { beforeAll, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import type { CstNode, Document } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { ensureEditableContainers } from '$lib/tree-operations/node-primitives';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_CONTAINER } from '$lib/core/directive/kinds';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { buildExitReplacement } from '$lib/tree-operations/list/exit-replacement';
import { buildQuoteExitReplacement } from '$lib/tree-operations/blockquote';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';
import { tableCellPasteSurface } from '$lib/components/blocks/table/table-cell-paste';
import { codePasteSurface } from '$lib/components/blocks/code/code-paste-surface';
import {
	makeContainerHarness,
	makeListContextAt,
	makeTopHarness,
	pasteContext
} from '$lib/test/harness/editor-actions';

type Route = (source: string) => Promise<Document>;

const top =
	(edit: (h: ReturnType<typeof makeTopHarness>) => unknown): Route =>
	async (source) => {
		const h = makeTopHarness(source);
		await edit(h);
		return h.deps.doc;
	};

const paste =
	(path: number[], offset: number, clipboard: string): Route =>
	async (source) => {
		__resetSchemaRegistriesForTests();
		ensurePasteSurface(tableCellPasteSurface);
		ensurePasteSurface(codePasteSurface);
		const h = makeTopHarness(source);
		await pasteDispatch(
			{ pastedText: clipboard, targetPath: path, offset },
			pasteContext({
				doc: h.deps.doc,
				blockEdit: h.actions,
				controller: createPasteCoordinator(h.deps, h.controller)
			})
		);
		return h.deps.doc;
	};

/** A structural edit inside the container at `path`, through its own commit scope. */
const inContainer =
	(
		path: number[],
		edit: (bundle: ReturnType<typeof makeContainerHarness>['bundle']) => Promise<unknown>
	): Route =>
	async (source) => {
		const h = makeContainerHarness(source, path);
		await edit(h.bundle);
		return h.deps.doc;
	};

const listEndEnter: Route = async (source) => {
	const h = makeTopHarness(source);
	const { listContext } = makeListContextAt(h.deps, 1, { controller: h.controller });
	await listContext.insertItemAfter(1);
	return h.deps.doc;
};

/** Enter at the end of the quote's last line, then Enter again on the empty line it made. */
const quoteExit: Route = async (source) => {
	const h = makeContainerHarness(source, [1]);
	await h.bundle.blockEdit.splitBlock(0, 1);
	await createBlockEditActions(h.deps, h.controller).replaceBlock(
		1,
		buildQuoteExitReplacement(h.deps.doc.children[1]),
		{ replacementIndex: 1, offset: 0 }
	);
	return h.deps.doc;
};

const listExit = (itemIndex: number): Route =>
	top((h) => {
		const list = h.deps.doc.children[1];
		const exit = buildExitReplacement(list, itemIndex, documentLineEnding(h.deps.doc));
		return h.actions.replaceBlock(1, exit.blocks, {
			replacementIndex: exit.paragraphIndex,
			offset: 0
		});
	});

// Each row's source is LF; the table runs it again mirrored to CRLF.
const ROUTES: { name: string; source: string; after: string; route: Route }[] = [
	// ── through the document's commit ──
	{
		name: 'ArrowDown past the last block appends an empty block, which keeps its break',
		source: 'intro\n\none',
		after: 'intro\n\none\n\n\n',
		route: top((h) => createFocusActions(h.deps, h.controller).moveFocus(2, 'start'))
	},
	{
		name: 'the trailing insert row adds an empty block, which keeps its break',
		source: 'intro\n\none',
		after: 'intro\n\none\n\n\n',
		route: top((h) => h.actions.insertParagraph(2, ''))
	},
	{
		name: 'a typed paragraph inserted past the end stays open',
		source: 'intro\n\none',
		after: 'intro\n\none\n\nx',
		route: top((h) => h.actions.insertParagraph(2, 'x'))
	},
	{
		name: 'deleting the last block leaves the block above open',
		source: 'intro\n\na\n\nb',
		after: 'intro\n\na',
		route: top((h) => h.actions.deleteBlock(2))
	},
	{
		name: 'Enter mid-line leaves the second half open',
		source: 'intro\n\npara',
		after: 'intro\n\npa\n\nra',
		route: top((h) => h.actions.splitBlock(1, 2))
	},
	{
		name: 'Enter at the end makes an empty last block, which keeps its break',
		source: 'intro\n\npara',
		after: 'intro\n\npara\n\n\n',
		route: top((h) => h.actions.splitBlock(1, 4))
	},
	{
		name: 'a list exit at the last item lands on an empty block, which keeps its break',
		source: 'intro\n\n- a\n- ',
		after: 'intro\n\n- a\n\n\n',
		route: listExit(1)
	},
	{
		name: 'a list exit mid-list leaves the list below open',
		source: 'intro\n\n- a\n- \n- c',
		after: 'intro\n\n- a\n\n\n- c',
		route: listExit(1)
	},
	{
		name: 'blocks ending in a line break pasted at the end stay open',
		source: 'intro\n\nhello',
		after: 'intro\n\nhello\n\n# T\n\nbody',
		route: paste([1], 5, '# T\n\nbody\n')
	},
	{
		name: 'blocks ending in a blank line pasted at the end add no break',
		source: 'intro\n\nhello',
		after: 'intro\n\nhello\n\n# h',
		route: paste([1], 5, '# h\n\n')
	},
	// ── through a container's commit, on the last line ──
	{
		name: 'Enter at the end of the last list item adds an empty item, which keeps its break',
		source: 'intro\n\n- a\n- b',
		after: 'intro\n\n- a\n- b\n- \n',
		route: listEndEnter
	},
	{
		name: 'a quote exit at the end lands on an empty block, which keeps its break',
		source: 'intro\n\n> a',
		after: 'intro\n\n> a\n\n\n',
		route: quoteExit
	},
	{
		name: 'deleting a last quote child leaves the quote open',
		source: 'intro\n\n> a\n>\n> b',
		after: 'intro\n\n> a',
		route: inContainer([1], (bundle) => bundle.blockEdit.deleteBlock(1))
	},
	{
		name: 'blocks pasted at the end of a last quote stay open',
		source: 'intro\n\n> hello',
		after: 'intro\n\n> hello\n>\n> x\n>\n> y',
		route: paste([1, 0], 5, 'x\n\ny\n')
	},
	{
		name: 'items pasted at the end of a last list stay open',
		source: 'intro\n\n- a\n- b',
		after: 'intro\n\n- a\n- b\n- one\n- two',
		route: paste([1, 1, 0], 1, '- one\n- two\n')
	},
	// ── a blank last line stays whole ──
	{
		name: 'an unclosed fence ending in an empty line keeps it',
		source: 'intro\n\nhello',
		after: 'intro\n\nhello\n\n```\ncode\n\n',
		route: paste([1], 5, '```\ncode\n\n')
	},
	{
		name: 'a quote’s trailing `>` line gives its break up when the quote becomes last',
		source: 'intro\n\n> q\n>\n\nlast',
		after: 'intro\n\n> q\n>',
		route: top((h) => h.actions.deleteBlock(2))
	},
	{
		name: 'a quote whose last child is an empty line keeps its break when it becomes last',
		source: 'intro\n\n> q\n>\n>\n\nlast',
		after: 'intro\n\n> q\n>\n>\n',
		route: top((h) => h.actions.deleteBlock(2))
	},
	{
		name: 'Enter at the end of a last quote line makes an empty line, which keeps its break',
		source: 'intro\n\n> a',
		after: 'intro\n\n> a\n>\n>\n',
		route: inContainer([1], (bundle) => bundle.blockEdit.splitBlock(0, 1))
	},
	{
		name: 'Enter at the end of a quote line in a last list item keeps the empty line’s break',
		source: 'intro\n\n- > a',
		after: 'intro\n\n- > a\n  >\n  >\n',
		route: inContainer([1, 0, 0], (bundle) => bundle.blockEdit.splitBlock(0, 1))
	},
	{
		name: 'an empty quote pasted mid-document ends its line',
		source: 'a\n\nb\n\nc',
		after: 'a\n\nb\n\n>\n\nc',
		route: paste([1], 1, '>')
	}
];

const crlf = (text: string) => text.replace(/\n/g, '\r\n');

type Shape = [kind: string, children: Shape | null][];
const shapeOf = (nodes: readonly CstNode[]): Shape =>
	nodes.map((node) => [node.kind, node.children ? shapeOf(node.children) : null]);

/** The blocks a reload of `doc`'s bytes holds once loaded, an empty container's paragraph included. */
function reloadedShape(doc: Document): Shape {
	const reload = parse(serialize(doc));
	for (const node of reload.children) ensureEditableContainers(node, documentLineEnding(reload));
	return shapeOf(reload.children);
}

describe('a structural edit keeps an open last line open, unless it is blank (GH #635, #616)', () => {
	describe.each([
		['LF', (text: string) => text],
		['CRLF', crlf]
	])('%s', (_ending, mirror) => {
		it.each(ROUTES)('$name', async ({ source, after, route }) => {
			const doc = await route(mirror(source));
			expect(serialize(doc)).toBe(mirror(after));
			expect(reloadedShape(doc)).toEqual(shapeOf(doc.children));
		});
	});
});

// An opaque container rebuilds its own raw, closer line included, inside the commit's chain rebuild,
// so the release has to run after it for the directive to end open.
describe('a directive container that ends the document', () => {
	it.each([
		[
			'the block below it deleted',
			'intro\n\n:::note\nbody\n:::\n\nlast',
			'intro\n\n:::note\nbody\n:::',
			top((h) => h.actions.deleteBlock(2))
		],
		[
			'a block split inside it',
			'intro\n\n:::note\nbody\n:::',
			'intro\n\n:::note\nbo\n\ndy\n:::',
			inContainer([1], (bundle) => bundle.blockEdit.splitBlock(0, 2))
		]
	])('%s keeps the closer line open', async (_name, source, after, route) => {
		activateDirectiveGrammar();
		const doc = await route(source);
		expect(doc.children[1].kind).toBe(DIRECTIVE_CONTAINER);
		expect(serialize(doc)).toBe(after);
	});
});

// Miss-analysis: the quote exit row asserted only after its second commit, so no row stopped on
// the empty line an Enter leaves inside a last quote, where the blank check read `>` instead.
describe('Enter at the end of a last alert line', () => {
	beforeAll(() => installPlugins([admonitionsPlugin()]));

	it.each([
		['LF', (text: string) => text],
		['CRLF', crlf]
	])('%s: the empty line keeps its break', async (_ending, mirror) => {
		const route = inContainer([1], (bundle) => bundle.blockEdit.splitBlock(0, 1));
		const doc = await route(mirror('intro\n\n> [!NOTE]\n> a'));
		expect(serialize(doc)).toBe(mirror('intro\n\n> [!NOTE]\n> a\n>\n>\n'));
		expect(reloadedShape(doc)).toEqual(shapeOf(doc.children));
	});
});
