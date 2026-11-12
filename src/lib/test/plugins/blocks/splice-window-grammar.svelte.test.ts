// @vitest-environment jsdom
// The byte splice's window starts where the editor's own grammar says a wait ends. Under a link
// definition still waiting on its title, a plugin line that cuts a paragraph short ends the wait
// and one that doesn't lets the title through, in each editor by its own plugin list.
// Miss-analysis: every waiting-definition row read with the built-in grammar, so none put a plugin
// block type's line between a definition and the change that finishes its title.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import type { NodeView } from '#lib/core/node-views.js';
import { serialize } from '#lib/core/serializer.js';
import { definePlugin, lineBlock } from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { changesBetween } from '#lib/tree-operations/byte-changes.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Mounted = MountedEditor<EditorTestSurface>;

/** A plugin whose `%%rule` line cuts the paragraph above it short, or runs on from it. */
const ruleLine = (name: string, interrupts: boolean) =>
	definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				lineBlock({
					name: 'rule',
					label: 'Rule',
					match: /^%%rule$/,
					interrupts,
					sample: '%%rule',
					insert: { none: 'a test block type' }
				})
			]
		})
	});

const LISTS = [
	{ name: 'cuts a paragraph short', plugins: () => [ruleLine('cutting', true)] },
	{ name: 'runs on from a paragraph', plugins: () => [ruleLine('quiet', false)] },
	{ name: 'is no block type', plugins: () => [] }
];

/** A definition, an indented line that may start its title, the `%%rule` line, then the line whose
 *  last byte finishes the title once the change writes it. */
const BEFORE = "[a]: /u\n    'code\n%%rule\nend\n\nlast\n";
const AFTER = BEFORE.replace('end', "end'");

const outline = (blocks: readonly NodeView[]): unknown[] =>
	blocks.map((block) => [
		block.kind,
		block.leadingTrivia,
		block.raw,
		outline(block.children ?? [])
	]);

/** An editor's document as a parse of its own bytes under its own grammar gives it. */
const fresh = (m: Mounted) =>
	outline(initDocument(m.source(), m.instance.__test.getGrammar()).doc.children);

async function mounted(plugins: ReturnType<typeof ruleLine>[]): Promise<Mounted> {
	const m = mountEditor<EditorTestSurface>({ source: BEFORE, plugins });
	await m.settle();
	return m;
}

describe('the splice window under a definition waiting on its title', () => {
	it.each(LISTS)('reads as a fresh parse where the rule line $name', async ({ plugins }) => {
		const grammar = (await mounted(plugins())).instance.__test.getGrammar();
		const { doc } = initDocument(BEFORE, grammar);
		const reading = spliceReading(measured(doc), BEFORE, changesBetween(BEFORE, AFTER), grammar)!;
		for (const window of [...reading.windows].reverse())
			doc.children.splice(window.at, window.count, ...window.blocks);

		expect(serialize(doc)).toBe(AFTER);
		expect(outline(doc.children)).toEqual(outline(initDocument(AFTER, grammar).doc.children));
	});

	it('reads each of two editors on one page by its own plugin list', async () => {
		const cutting = await mounted([ruleLine('cutting', true)]);
		const quiet = await mounted([ruleLine('quiet', false)]);
		for (const m of [cutting, quiet, cutting]) {
			const at = m.source().indexOf('end') + 3;
			expect(await m.instance.edit().replace({ from: at, to: at }, "'").commit()).toEqual({
				ok: true
			});
			await m.settle();
			expect(outline(m.instance.__test.getDocument().children)).toEqual(fresh(m));
		}
		// The title runs through the quiet line and stops at the cutting one.
		expect(quiet.instance.__test.getDocument().children.map((b) => b.kind)).toEqual([
			'linkReferenceDefinition',
			'paragraph'
		]);
		expect(cutting.instance.__test.getDocument().children).toHaveLength(5);
	});
});
