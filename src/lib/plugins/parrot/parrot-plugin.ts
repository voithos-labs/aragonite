// parrot-plugin.ts
import {
	caretOffsetAtPoint,
	declarePluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockOpener,
	simpleLeafClosure,
	type CaretTarget,
	type EditorPlugin
} from '$lib/plugin';
import ParrotBlock from './ParrotBlock.svelte';

export const PARROT = 'parrot';

/** Where a press in the block puts the caret. The caption renders the bytes after `%%parrot `,
 *  so an offset in it sits that far along the source; the revealed source IS the source. */
function parrotCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): CaretTarget | null {
	const source = blockEl.querySelector<HTMLElement>('.parrot-source');
	const view = source ?? blockEl.querySelector<HTMLElement>('.parrot-caption');
	if (!view) return null;
	const offset = caretOffsetAtPoint(view, clientX, clientY) ?? 0;
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
