/**
 * Grammar-side activation for the `:::name` directive syntax. The public `activateDirectives`
 * adds the components (core can't import them) and makes both belong to no plugin. A call, not an
 * import side effect, so `:::` and `:` stay free until someone asks. Must run before the editor
 * first parses (G1.17); calling it twice is a no-op, since every step checks its registration first.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';
import { defaultGrammarView, type GrammarView } from '../../schema/block-openers';

export function activateDirectiveGrammar(): void {
	// The inline handler has no registration of its own to check, so it borrows the
	// `directiveText` flag, read before it is set; the `:` trigger is shared with emoji.
	const alreadyActive = isInlineKindDeclared(DIRECTIVE_TEXT);

	registerDirectiveKinds();
	registerDirectiveOpeners();
	registerDirectiveTextKind();

	if (!alreadyActive) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end, grammar?: GrammarView) =>
			recognizeTextDirective(raw, pos, end, kind, grammar ?? defaultGrammarView)
		);
	}
}
