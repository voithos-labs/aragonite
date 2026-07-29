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
 * already-parsed document would not re-parse. A second activation site (callout +
 * route, or HMR) is a no-op: every step guards on something the directive tier
 * itself owns — its kinds, its opener, its inline kind — never on a shared
 * resource another plugin could be holding.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind, isInlineKindDeclared } from '../../schema/plugin-kind';
import { registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';

export function activateDirectiveGrammar(): void {
	// The three steps below each guard on their own registration; the inline rung has
	// nothing of its own to probe, so it borrows the `directiveText` kind's latch —
	// read HERE, before `registerDirectiveTextKind` sets it. It cannot ask whether `:`
	// is taken: the trigger is SHARED (emoji registers on it at its own rung), so that
	// question answers for someone else's plugin and skips this recognizer, leaving
	// the tier's kind and widget live with nothing to recognize.
	const alreadyActive = isInlineKindDeclared(DIRECTIVE_TEXT);

	registerDirectiveKinds();
	registerDirectiveOpeners();
	registerDirectiveTextKind();

	if (!alreadyActive) {
		const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
		registerInlineSyntax(':', (raw, pos, end) => recognizeTextDirective(raw, pos, end, kind));
	}
}
