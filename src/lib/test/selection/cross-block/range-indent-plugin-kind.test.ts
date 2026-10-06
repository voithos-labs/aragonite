// @vitest-environment jsdom
// A plugin kind that binds Tab to its own indent command and registers what it does over a range
// indents its blocks under a range, as the list and code kinds do.
// Miss-analysis: every range indent row drew list items or a code block, the two kinds the range
// indent named by command id, so no row asked a kind it didn't name.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import {
	augmentBlockKind,
	definePluginBlock,
	registerBlockCommand,
	registerBlockOpener,
	registerRangeIndent,
	type EditorPlugin
} from '$lib/plugin';
import { trimTrailingLineEnding } from '$lib/core/lines';
import RevealLeafBlock from '../../blocks/fixtures/RevealLeafBlock.svelte';
import { registerRevealLeafKind } from '../../blocks/fixtures/reveal-leaf';
import { testContainer } from '$lib/test/harness/test-kinds';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import type { AnyCommandId } from '$lib/schema/command-id';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Seam = { getUndoStack(): { undo: unknown[] } };

const KIND = 'quote-leaf';

/** An `@@ ` line whose indent command puts a tab after its marker, at a caret or over a range. */
function quoteLeafPlugin(): EditorPlugin {
	return definePluginBlock({
		name: KIND,
		kind: KIND,
		component: RevealLeafBlock,
		register: () => {
			const kind = registerRevealLeafKind(KIND);
			const indent = registerBlockCommand(kind, 'quoteLeaf.indent', () => true);
			augmentBlockKind(kind, { keymap: [{ chord: 'Tab', command: indent }] });
			registerRangeIndent(kind, indent, (node, range) => ({
				text: `@@ \t${trimTrailingLineEnding(node.raw).slice(3)}`,
				selection: { start: range.start + 1, end: range.end + 1 }
			}));
			registerBlockOpener(kind, {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) =>
					ctx.line.text.startsWith('@@ ')
						? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
						: null
			});
		}
	});
}

describe('Tab over a range holding a plugin kind with its own indent', () => {
	it('indents each of its blocks the range reaches, in one undo entry', async () => {
		const mounted = mountEditor<Seam>({
			source: 'para\n\n@@ one\n\n@@ two\n',
			plugins: [quoteLeafPlugin()]
		});
		await mounted.settle();
		await mounted.instance.setSelection({
			anchor: { path: [0], offset: 1 },
			focus: { path: [2], offset: 5 }
		});
		await mounted.settle();

		await pressKey(surfaceAt(mounted, [2]), { key: 'Tab' });

		expect(mounted.source()).toBe('para\n\n@@ \tone\n\n@@ \ttwo\n');
		expect(mounted.instance.__test.getUndoStack().undo).toHaveLength(1);
	});
});

// Miss-analysis: a lines form on a container kind registered quietly and was never read, since a
// range indent reads lines forms at the leaf holding the text.
describe('registerRangeIndent on a container kind', () => {
	it('warns, since no range indent ever reads it', () => {
		const kind = testContainer('quote-box', { rebuildRaw: () => {} });

		registerRangeIndent(kind, 'quoteBox.indent' as AnyCommandId, () => null);

		expect(takeDevWarns().map((warn) => warn.tag)).toEqual(['registry']);
	});
});
