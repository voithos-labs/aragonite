// Miss-analysis: every escalation test checked the bytes of one bare rebuild and never edited the
// block again, so no test compared a live session with a reload of the escalated bytes.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, serialize } from '#lib';
import {
	declarePluginKind,
	documentLineEnding,
	escalatedFenceLength,
	getPluginMetadata,
	matchFenceInfo,
	OPENER_PRIORITIES,
	registerBlockKind,
	registerBlockOpener,
	scanFence,
	setPluginMetadata,
	type CstNode
} from '#lib/plugin.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import { makeTopHarness, type TopHarness } from '#lib/test/harness/editor-actions.js';
import { scanCompiled } from '#lib/test/harness/search-replace.js';
import { testClosure } from '#lib/test/support/closure.js';

// ── A third-party kind following the guide's "Code in metadata" recipe ──────

interface SketchMetadata {
	code: string;
	marker: '`' | '~';
	fenceLength: number;
	closerLength: number;
	info: string;
	lineEnding: string;
	closerLineEnding: string;
}

function rebuildSketchRaw(node: CstNode): void {
	const meta = getPluginMetadata<SketchMetadata>(node)!;
	const length = escalatedFenceLength(meta.code, meta.marker, meta.fenceLength);
	const closer = meta.marker.repeat(Math.max(meta.closerLength, length));
	const opener = meta.marker.repeat(length) + meta.info + meta.lineEnding;
	node.raw = opener + meta.code + closer + meta.closerLineEnding;
}

// Declines an indented, unterminated or decorated fence, which the code block keeps.
function registerSketchKind(): void {
	const sketch = declarePluginKind('sketch');
	const matchSketch = matchFenceInfo('sketch');
	registerBlockKind(sketch, {
		gapEdges: 'before',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// A container with no children has no caret target inside it, so it is focused whole.
		blockFocus: 'whole-block',
		container: { contract: 'opaque', rebuildRaw: rebuildSketchRaw },
		closure: testClosure
	});
	registerBlockOpener(sketch, {
		priority: OPENER_PRIORITIES.fencedCode - 6,
		interruptsParagraph: (line) => matchSketch(line) !== null,
		tryOpen(ctx) {
			const fence = matchSketch(ctx.line.text);
			if (!fence || fence.indent !== '') return null;
			const scan = scanFence(ctx, fence);
			const closer = scan.closer === -1 ? '' : ctx.lines[scan.closer].text;
			if (!/^(`+|~+)$/.test(closer)) return null;
			const node: CstNode = {
				kind: sketch,
				leadingTrivia: ctx.leadingTrivia,
				raw: '',
				children: []
			};
			setPluginMetadata<SketchMetadata>(node, {
				code: scan.body,
				marker: fence.marker,
				fenceLength: fence.length,
				closerLength: closer.length,
				info: fence.infoRaw,
				lineEnding: ctx.line.lineEnding,
				closerLineEnding: ctx.lines[scan.closer].lineEnding
			});
			rebuildSketchRaw(node);
			return { node, consumed: scan.consumed };
		}
	});
}

// ── Routes ───────────────────────────────────────────────────────────────────

type Edit = (h: TopHarness) => Promise<unknown> | void;

/** The container's own commit, the one a plugin's `updateOwnMetadata` makes. */
const commitCode =
	(code: string): Edit =>
	(h) =>
		h.actions.updateBlockMetadata(0, { code });

/** A keystroke in the container's body paragraph, written in place. */
const typeInBody =
	(index: number, raw: string): Edit =>
	(h) => {
		const owner = h.deps.doc.children[0];
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
		const write = legalizeWrite(body, index, raw, 'authored');
		const typing = createLeafTyping(h.deps, h.controller);
		expect(typing.writeLeafInPlace(docPathFrom([0, index]), write, 0).wrote).toBe(true);
	};

/** Backspace at the start of the paragraph below the container, which joins it into the body. */
const joinBelow: Edit = (h) => h.actions.mergeWithPrevious(1);

/** Replace-all, which reparses the container from its rewritten bytes. */
const replaceAll =
	(query: string, template: string): Edit =>
	(h) =>
		createSearchReplace(h.deps, h.controller).replaceAll(scanCompiled(h.deps.doc, query), template);

interface Row {
	name: string;
	source: string;
	/** Puts a body line reading as the closer, so the rebuild lengthens the fence. */
	collide: Edit;
	plain: Edit;
}

const ROWS: Row[] = [
	{
		name: 'mermaid, by a code commit',
		source: '```mermaid\ngraph TD\n```\n',
		collide: commitCode('graph TD\n```\n'),
		plain: commitCode('graph LR\n')
	},
	{
		name: 'a directive with no title, by typing in its body',
		source: ':::spoiler\nhidden\n:::\n',
		collide: typeInBody(0, 'hidden\n:::\n'),
		plain: typeInBody(0, 'shown\n')
	},
	{
		name: 'a directive with a title, by typing in its body',
		source: ':::note Heads up\nbody\n:::\n',
		collide: typeInBody(1, 'body\n:::\n'),
		plain: typeInBody(1, 'edited\n')
	},
	{
		name: 'a directive with no title, joined into by Backspace',
		source: ':::spoiler\n::\n:::\n:\n',
		collide: joinBelow,
		plain: typeInBody(0, 'shown\n')
	},
	{
		name: 'a directive with a title, joined into by Backspace',
		source: ':::note Heads up\n::\n:::\n:\n',
		collide: joinBelow,
		plain: typeInBody(1, 'edited\n')
	},
	{
		name: 'a directive with no title, by replace-all, which reparses the bytes it writes',
		source: ':::spoiler\nhidden\nX\n:::\n',
		collide: replaceAll('X', ':::'),
		plain: typeInBody(0, 'shown\n')
	},
	{
		name: 'a plugin kind with its code in metadata, by a code commit',
		source: '```sketch\nbox\n```\n',
		collide: commitCode('box\n```\n'),
		plain: commitCode('arrow\n')
	}
];

describe('an edit after a lengthened fence gives the bytes a reload would (#640)', () => {
	beforeEach(() => {
		installPlugins([admonitionsPlugin()]);
		registerMermaidKind();
		registerSketchKind();
	});

	for (const row of ROWS) {
		it(`${row.name}: keeps the longer fence, as a reload does`, async () => {
			const live = makeTopHarness(row.source);
			await row.collide(live);
			const escalated = serialize(live.deps.doc);
			expect(escalated).not.toBe(row.source);

			const reloaded = makeTopHarness(escalated);
			expect(reloaded.deps.doc.children[0].kind).toBe(live.deps.doc.children[0].kind);
			await row.plain(live);
			await row.plain(reloaded);
			expect(serialize(live.deps.doc)).toBe(serialize(reloaded.deps.doc));
		});
	}
});
