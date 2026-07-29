/**
 * Grammar-side activation for the `:::name` directive primitive: registers the
 * generic fallback kinds, the shared `:::`/`::` block opener, the `directiveText`
 * inline kind + widget, and the inline `:` recognizer. No components — core must
 * not reach the component tree; the public entry (`activateDirectives`) layers the
 * generic render on top of this.
 *
 * Call-based, not a module-load side effect: a consumer that never calls this
 * leaves `:::` and `:` unclaimed. Activate at startup, before the editor parses —
 * the opener must land before the grammar-consumed latch trips (G1.17), or an
 * already-parsed document would not re-parse. Every step guards its public probe,
 * so a second activation site (callout + route, or HMR) is a no-op.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';

export function activateDirectiveGrammar(): void {
	// The whole activation is latched on the `directiveText` kind, read before the
	// steps below declare it. The inline rung has no probe of its own that would do:
	// `:` is a SHARED trigger (emoji registers on it at its own rung), so asking
	// whether the trigger is taken answers for someone else's plugin and skips this
	// recognizer — leaving the tier's kind and widget live with nothing to recognize.
	const alreadyActive = isInlineKindDeclared(DIRECTIVE_TEXT);

	registerDirectiveKinds();
	registerDirectiveOpeners();
	registerDirectiveTextKind();

	if (!alreadyActive) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end) => recognizeTextDirective(raw, pos, end, kind));
	}
}
