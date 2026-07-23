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
import { declaredPluginInlineKind } from '../../schema/plugin-kind';
import { getInlineRungs, registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';

export function activateDirectiveGrammar(): void {
	registerDirectiveKinds();
	registerDirectiveOpeners();
	registerDirectiveTextKind();

	if (getInlineRungs(':').length === 0) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end) => recognizeTextDirective(raw, pos, end, kind));
	}
}
