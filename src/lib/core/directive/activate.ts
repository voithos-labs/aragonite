/**
 * Grammar-side activation for the `:::name` directive primitive. No components: core must not
 * reach the component tree, so the public `activateDirectives` layers render on top of this.
 * Call-based, not a module-load side effect, so a consumer that never calls it leaves `:::` and
 * `:` unclaimed. Must run before the editor parses, ahead of the grammar-consumed latch (G1.17).
 * A second activation site is a no-op: every step guards on something the tier itself owns.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';

export function activateDirectiveGrammar(): void {
	// The inline rung has nothing of its own to probe, so it borrows the `directiveText` latch,
	// read HERE before `registerDirectiveTextKind` sets it. It cannot ask whether `:` is taken:
	// the trigger is SHARED (emoji rungs on it too), so that question answers for another plugin.
	const alreadyActive = isInlineKindDeclared(DIRECTIVE_TEXT);

	registerDirectiveKinds();
	registerDirectiveOpeners();
	registerDirectiveTextKind();

	if (!alreadyActive) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end) => recognizeTextDirective(raw, pos, end, kind));
	}
}
