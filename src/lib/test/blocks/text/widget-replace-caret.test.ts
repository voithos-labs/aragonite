// @vitest-environment jsdom
// Text replacing a selected widget puts the caret right after itself, since the widget it replaced
// was the only thing selected and the browser keeps no caret of its own (GH #440, #441).
// Miss-analysis: the widget-splice pins recorded the one commit's bytes and never the caret, so
// a second key or an awaited insert landing nowhere was invisible to them.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	createTextClipboard,
	type TextClipboardDeps
} from '$lib/components/blocks/text/text-clipboard';
import { replaceSelectedWidget } from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';

const SOURCE = 'lead![cat](x) tail\n';
const WIDGET = { start: 4, end: 13 };

function fixture() {
	const node: CstNode = parse(SOURCE).children[0];
	const log: string[] = [];
	let finishWrite = () => {};
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	widgetSelection.select({ paragraphPath: [0], sourceStart: WIDGET.start, preSelectOffset: 2 });
	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		blockEdit: {
			updateBlockContent: (_: number, raw: string, before: number, after: number) => {
				log.push(`write ${raw.trimEnd()} ${before}->${after}`);
				return new Promise<void>((resolve) => {
					finishWrite = () => {
						log.push('landed');
						resolve();
					};
				});
			}
		},
		widgetSelection,
		setPendingCursor: (offset: number | null) => void log.push(`caret ${offset}`)
	};
	return { deps, log, widgetSelection, finish: () => finishWrite() };
}

describe('replacing a selected widget', () => {
	it('sets the caret after the text before the write lands, and resolves after it', async () => {
		const { deps, log, widgetSelection, finish } = fixture();

		const replaced = replaceSelectedWidget(deps as never, WIDGET, 2, 'XY');
		expect(log).toEqual(['write leadXY tail 2->6', 'caret 6']);
		expect(widgetSelection.getSelected()).toBeNull();

		finish();
		await replaced;
		expect(log.at(-1)).toBe('landed');
	});

	it('is the route a paste over the widget takes', async () => {
		const { deps, log, finish } = fixture();
		const clipboard = createTextClipboard({
			...deps,
			cursor: { getRaw: () => null, getRawSelection: () => null },
			selection: { isCrossBlock: false, anchor: null, focus: null },
			crossBlock: { handlePaste: async () => false },
			stickyColumn: { reset: () => {} },
			edgeAffinity: { reset: () => {}, get: () => null, note: () => {}, noteTyping: () => {} },
			isReadOnly: () => false,
			foldRevealBeforeMutation: () => null,
			linkRef: undefined
		} as unknown as TextClipboardDeps);
		const store = new Map([['text/plain', 'text']]);
		const pasted = clipboard.onPaste({
			preventDefault: () => {},
			clipboardData: { getData: (type: string) => store.get(type) ?? '', files: [], items: [] }
		} as never);

		await vi.waitFor(() => expect(log[0]).toMatch(/^write/));
		finish();
		await pasted;
		expect(log).toContain('caret 8');
		expect(log.at(-1)).toBe('landed');
	});
});
