// @vitest-environment jsdom
// A render-primary leaf's hint judges its shown source only while that source is open: once it
// folds, an undo that empties the block brings the hint back without reopening it.
import { describe, it, expect, afterEach } from 'vitest';
import {
	definePluginBlock,
	registerBlockOpener,
	simpleLeafClosure,
	OPENER_PRIORITIES
} from '#lib/plugin.js';
import { displayLength } from '#lib/core/lines.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	typeInto,
	type BlockLookup
} from '#lib/test/harness/mount-editor.svelte.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import HintRevealBlock from './fixtures/HintRevealBlock.svelte';

installLayoutStubs();
afterEach(destroyMountedEditors);

const MARKER = '@@';

/** A one-line kind spelled `@@ <body>`, whose body is what follows the marker and its space. */
const hintRevealPlugin = definePluginBlock({
	name: 'hint-reveal',
	kind: 'hint-reveal',
	component: HintRevealBlock,
	register: () => {
		const kind = testLeaf('hint-reveal', {
			closure: simpleLeafClosure({
				focus: { mode: 'implemented', via: 'the render-primary leaf under test' },
				searchPaint: { mode: 'inherit-default' },
				undo: { mode: 'inherit-default' },
				simOracle: { mode: 'inherit-default' }
			}),
			bodyRange: (node) =>
				node.raw.startsWith(`${MARKER} `)
					? { start: MARKER.length + 1, end: displayLength(node.raw) }
					: null
		});
		registerBlockOpener(kind, {
			priority: OPENER_PRIORITIES.thematicBreak - 5,
			interruptsParagraph: false,
			tryOpen: (ctx) =>
				ctx.lines[ctx.index].text.startsWith(MARKER)
					? {
							node: { kind, raw: ctx.lines[ctx.index].raw, leadingTrivia: ctx.leadingTrivia },
							consumed: 1
						}
					: null
		});
	}
});

describe('placeholder: a folded render-primary leaf', () => {
	it('an undo while folded brings the hint back, judged against the node', async () => {
		const editor = mountEditor<BlockLookup>({
			source: `${MARKER} \n`,
			plugins: [hintRevealPlugin],
			placeholder: (block) => block.kind,
			scrollMode: 'host'
		});
		const folded = () =>
			editor.target.querySelector('.hint-rendered-block')?.getAttribute('data-folded-hint');
		expect(folded()).toBe('hint-reveal');

		editor.instance.__test.getBlockComponent([0]).focus?.(3);
		await editor.settle();
		const source = editor.target.querySelector<HTMLElement>('.hint-source-block')!;
		typeInto(source, `${MARKER} x`);
		await editor.settle();
		source.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await settleEditor();
		expect(editor.source()).toBe(`${MARKER} x\n`);
		expect(folded()).toBe('');

		editor.instance.runCommand('history.undo');
		await editor.settle();
		expect(editor.source()).toBe(`${MARKER} \n`);
		expect(folded()).toBe('hint-reveal');
	});
});
