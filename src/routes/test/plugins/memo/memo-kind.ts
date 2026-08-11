/**
 * Harness validator for the plain editable-leaf tier. The recognizer is deliberately
 * trivial: the kind exists to drive `createEditableLeaf({ mode: 'plain' })` through the
 * public factory, not to be a useful block. Dev/e2e harness only.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockCommand,
	registerBlockOpener,
	simpleLeafClosure
} from '$lib/plugin';

export const MEMO_BLOCK = 'memo';

export function registerMemoBlock(): void {
	const memo = declarePluginKind(MEMO_BLOCK);

	// Harness-only commands over the editable-leaf tier's minted-command dispatch: `memo.tag`
	// commits through the sanctioned route, `memo.boom` throws so containment surfaces.
	const tag = registerBlockCommand(memo, 'memo.tag', (ctx) => {
		ctx.updateMetadata({ memoTagged: true });
		return true;
	});
	const boom = registerBlockCommand(memo, 'memo.boom', () => {
		throw new Error('memo.boom: intentional handler failure (harness)');
	});

	registerBlockKind(memo, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: [
			{ chord: 'Mod+Shift+K', command: tag },
			{ chord: 'Mod+Shift+J', command: boom }
		],
		conformanceFixture: '%%a memo\n',
		closure: simpleLeafClosure({
			focus: {
				mode: 'implemented',
				via: 'createEditableLeaf plain — always-editable source caret'
			},
			searchPaint: { mode: 'implemented', via: 'source raw scanned; matches painted as marks' },
			undo: {
				mode: 'implemented',
				via: 'plain mode — per-keystroke commits with prose undo batching'
			},
			simOracle: {
				mode: 'implemented',
				via: 'editable-leaf-plain / editable-leaf-command e2e'
			}
		})
	});

	registerBlockOpener(memo, {
		// `%%` collides with no built-in matcher; 25 sits between the block-math
		// opener (15) and the shared `:::` directive opener (45).
		priority: 25,
		interruptsParagraph: (text) => text.startsWith('%%'),
		tryOpen(ctx) {
			if (!ctx.line.text.startsWith('%%')) return null;
			return {
				node: { kind: memo, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
				consumed: 1
			};
		}
	});
}
