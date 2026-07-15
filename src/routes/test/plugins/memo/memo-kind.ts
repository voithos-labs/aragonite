/**
 * Harness validator for the plain editable-leaf tier: a `%%`-prefixed
 * single-line memo leaf. The recognizer is deliberately trivial — the kind
 * exists to drive `createEditableLeaf({ mode: 'plain' })` through the public
 * factory, not to be a useful block. Dev/e2e harness only.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockCommand,
	registerBlockOpener
} from '$lib/plugin';

export const MEMO_BLOCK = 'memo';

export function registerMemoBlock(): void {
	const memo = declarePluginKind(MEMO_BLOCK);

	// Two harness-only block commands exercise the editable-leaf tier's minted-command
	// dispatch: `memo.tag` commits metadata through the sanctioned route (one
	// metadataUpdate edit), `memo.boom` throws so the seam's containment + 'command'
	// error routing surface end-to-end. Bound below on the memo keymap.
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
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: {
				mode: 'implemented',
				via: 'createEditableLeaf plain — always-editable source caret'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — Backspace at the edge moves focus, never concatenates'
			},
			selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
			searchPaint: { mode: 'implemented', via: 'source raw scanned; matches painted as marks' },
			reorder: {
				mode: 'implemented',
				via: 'whole-block drag reorder through the parent BlockList'
			},
			undo: {
				mode: 'implemented',
				via: 'plain mode — per-keystroke commits with prose undo batching'
			},
			clipboard: { mode: 'inherit-default' },
			simOracle: {
				mode: 'implemented',
				via: 'editable-leaf-plain / editable-leaf-command e2e under the [invariant:] watcher'
			}
		}
	});

	registerBlockOpener(memo, {
		// `%%` collides with no built-in matcher; 25 sits between the harness's
		// block-math opener (15) and the shared `:::` directive opener (45).
		priority: 25,
		interruptsParagraph: (text) => text.startsWith('%%'),
		tryOpen(ctx) {
			if (!ctx.line.text.startsWith('%%')) return null;
			return {
				node: { kind: memo, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
				nextIndex: ctx.index + 1
			};
		}
	});
}
