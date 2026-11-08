/**
 * A harness block that exercises the plain editable leaf. What it recognizes is deliberately
 * trivial: the kind exists to drive `createEditableLeaf({ mode: 'plain' })` through the public
 * factory, not to be a useful block. Dev and e2e harness only.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockCommand,
	setPluginMetadata,
	type BlockView,
	type CstNode
} from '#lib/plugin.js';

export const MEMO_BLOCK = 'memo';
// A memo whose line opens with this prefix is tagged; its metadata says so.
const TAGGED = '%%!';

export function registerMemoBlock(view: BlockView): void {
	const memo = declarePluginKind(MEMO_BLOCK);

	// Harness-only commands, dispatched the way an editable leaf's registered commands are:
	// `memo.tag` writes the tag into the bytes (`%%!`), `memo.boom` throws so the containment shows.
	const tag = registerBlockCommand(memo, 'memo.tag', (ctx) => {
		if (ctx.node.raw.startsWith(TAGGED)) return false;
		ctx.replaceRaw(TAGGED + ctx.node.raw.slice(2));
		return true;
	});
	const boom = registerBlockCommand(memo, 'memo.boom', () => {
		throw new Error('memo.boom: intentional handler failure (harness)');
	});

	registerBlockKind(memo, {
		view,
		opener: {
			// Lower priorities try first, so 27 lets the bundled parrot opener (25) take `%%parrot`
			// lines before the memo sees them.
			priority: 27,
			interruptsParagraph: (text) => text.startsWith('%%'),
			tryOpen(ctx) {
				if (!ctx.line.text.startsWith('%%')) return null;
				const node: CstNode = { kind: memo, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
				if (ctx.line.text.startsWith(TAGGED)) setPluginMetadata(node, { memoTagged: true });
				return { node, consumed: 1 };
			}
		},
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: [
			{ chord: 'Mod+Shift+K', command: tag },
			{ chord: 'Mod+Shift+J', command: boom }
		],
		conformanceFixture: '%%a memo\n'
	});
}
