/**
 * Harness validator for the plain editable-leaf tier: a `%%`-prefixed
 * single-line memo leaf. The recognizer is deliberately trivial — the kind
 * exists to drive `createEditableLeaf({ mode: 'plain' })` through the public
 * factory, not to be a useful block. Dev/e2e harness only.
 */

import { declarePluginKind, registerBlockKind, registerBlockOpener } from '$lib/plugin';

export const MEMO_BLOCK = 'memo';

export function registerMemoBlock(): void {
	const memo = declarePluginKind(MEMO_BLOCK);

	registerBlockKind(memo, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false
	});

	registerBlockOpener(memo, {
		// `%%` collides with no built-in matcher; 25 sits between the harness's
		// math (15) and callout (45) fence claims.
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
