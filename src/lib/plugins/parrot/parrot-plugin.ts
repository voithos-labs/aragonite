// parrot-plugin.ts
import {
	declarePluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockOpener,
	simpleLeafClosure,
	type EditorPlugin
} from '$lib/plugin';
import ParrotBlock from './ParrotBlock.svelte';

export const PARROT = 'parrot';

/** The character offset under a point in one of the block's two views, clamped into that
 *  view's box so a press on the bird above it still names one. Each holds a single text node. */
function offsetAtPoint(view: HTMLElement, clientX: number, clientY: number): number {
	const box = view.getBoundingClientRect();
	const x = Math.min(Math.max(clientX, box.left + 1), box.right - 1);
	const y = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1);
	const doc = view.ownerDocument;
	// caretRangeFromPoint is the Chromium/WebKit spelling, caretPositionFromPoint the standard one.
	const range = doc.caretRangeFromPoint?.(x, y);
	if (range && view.contains(range.startContainer)) return range.startOffset;
	const position = doc.caretPositionFromPoint?.(x, y);
	return position && view.contains(position.offsetNode) ? position.offset : 0;
}

/** Where a press in the block puts the caret. The caption renders the bytes after `%%parrot `,
 *  so an offset in it sits that far along the source; the revealed source IS the source. */
function parrotCaretAtPoint(blockEl: HTMLElement, clientX: number, clientY: number) {
	const source = blockEl.querySelector<HTMLElement>('.parrot-source');
	const view = source ?? blockEl.querySelector<HTMLElement>('.parrot-caption');
	if (!view) return null;
	const offset = offsetAtPoint(view, clientX, clientY);
	return { path: [], offset: source ? offset : offset + '%%parrot '.length };
}

function registerParrotBlock(): void {
	const parrot = declarePluginKind(PARROT);

	registerBlockKind(parrot, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '%%parrot party responsibly\n',
		caretTargetAtPoint: parrotCaretAtPoint,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'implemented', via: 'source raw scanned, matches painted as marks' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockOpener(parrot, {
		priority: 25,
		interruptsParagraph: (text) => text.startsWith('%%parrot'),
		tryOpen(ctx) {
			if (!ctx.line.text.startsWith('%%parrot')) return null;
			const node = { kind: parrot, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
			return { node, consumed: 1 };
		}
	});
}

export function parrotPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'parrot',
		kind: PARROT,
		component: ParrotBlock,
		register: registerParrotBlock
	});
}
