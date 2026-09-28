// Miss-analysis: the open-last-line suite checked the bytes a structural edit left, never an edit
// after it, so no test saw an opaque container rebuild from a line ending its metadata had missed.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, serialize } from '$lib';
import { documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { makeTopHarness, type TopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/testing/parse-convergence';

type Edit = (h: TopHarness) => Promise<unknown> | void;

const commitCode =
	(code: string): Edit =>
	(h) =>
		h.actions.updateBlockMetadata(0, { code });

const typeInBody =
	(raw: string): Edit =>
	(h) => {
		const owner = h.deps.doc.children[0];
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
		const write = legalizeWrite(body, 0, raw, 'authored');
		const typing = createLeafTyping(h.deps, h.controller);
		expect(typing.writeLeafInPlace(docPathFrom([0, 0]), write, 0).wrote).toBe(true);
	};

/** The document's last block goes, so the container above gives its line ending up. */
const deleteLast: Edit = (h) => h.actions.deleteBlock(h.deps.doc.children.length - 1);

/** A paragraph goes below an open last block, which ends its line first. */
const insertBelow: Edit = (h) => h.actions.insertParagraph(h.deps.doc.children.length, 'x');

const ROWS: { name: string; source: string; structural: Edit; plain: Edit }[] = [
	{
		name: 'mermaid releasing its ending',
		source: '```mermaid\ngraph TD\n```\n\npara',
		structural: deleteLast,
		plain: commitCode('graph LR\n')
	},
	{
		name: 'mermaid ending its open line',
		source: '```mermaid\ngraph TD\n```',
		structural: insertBelow,
		plain: commitCode('graph LR\n')
	},
	{
		name: 'a directive releasing its ending',
		source: ':::spoiler\nhidden\n:::\n\npara',
		structural: deleteLast,
		plain: typeInBody('shown\n')
	},
	{
		name: 'a directive ending its open line',
		source: ':::spoiler\nhidden\n:::',
		structural: insertBelow,
		plain: typeInBody('shown\n')
	}
];

describe('an opaque container’s metadata follows the open last line (#640)', () => {
	beforeEach(() => {
		installPlugins([admonitionsPlugin()]);
		registerMermaidKind();
	});

	for (const row of ROWS) {
		it(`${row.name}: the next edit gives the bytes a reload would`, async () => {
			const live = makeTopHarness(row.source);
			await row.structural(live);
			expect(describeConvergence(live.deps.doc)).toBeNull();

			const reloaded = makeTopHarness(serialize(live.deps.doc));
			await row.plain(live);
			await row.plain(reloaded);
			expect(serialize(live.deps.doc)).toBe(serialize(reloaded.deps.doc));
		});
	}
});
