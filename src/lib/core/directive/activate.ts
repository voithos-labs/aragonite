/**
 * Grammar-side activation for the `:::name` directive syntax. The public `activateDirectives`
 * passes in the two kinds' views, since core can't import components. A call, not an import side
 * effect, so `:::` and `:` stay free until someone asks. Must run before the editor first parses
 * (G1.17); calling it twice is a no-op, since every step checks its registration first.
 */

import {
	registerDirectiveKinds,
	registerDirectiveTextKind,
	DIRECTIVE_TEXT,
	type DirectiveViews
} from './kinds';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';
import { type GrammarView } from '../../schema/block-openers';
import { defaultGrammarView } from '../../schema/editor-grammar';

export function activateDirectiveGrammar(views: DirectiveViews): void {
	// The inline handler has no registration of its own to check, so it borrows the
	// `directiveText` flag, read before it is set; the `:` trigger is shared with emoji.
	const alreadyActive = isInlineKindDeclared(DIRECTIVE_TEXT);

	registerDirectiveKinds(views);
	registerDirectiveTextKind();

	if (!alreadyActive) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end, grammar?: GrammarView) =>
			recognizeTextDirective(raw, pos, end, kind, grammar ?? defaultGrammarView)
		);
	}
}
