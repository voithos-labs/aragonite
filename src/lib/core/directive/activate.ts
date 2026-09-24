/**
 * Grammar-side activation for the `:::name` directive syntax. No components: core must not reach
 * the component tree, so the public `activateDirectives` adds rendering on top of this. A call
 * rather than an import side effect, so a consumer that never calls it leaves `:::` and `:` free.
 * Must run before the editor first parses (G1.17). Calling it twice is a no-op: every step checks
 * its own registration first.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';
import { defaultGrammarView, type GrammarView } from '../../schema/block-openers';
import { registerAsCore } from '../../schema/plugin-install';

export function activateDirectiveGrammar(): void {
	// The shared directive kinds are core whichever plugin's setup calls this first; only the
	// names a plugin registers belong to it.
	registerAsCore(() => {
		// The inline handler has no registration of its own to check, so it borrows the
		// `directiveText` flag, read here before `registerDirectiveTextKind` sets it. It cannot ask
		// whether `:` is taken: that trigger is shared (emoji uses it too).
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
	});
}
