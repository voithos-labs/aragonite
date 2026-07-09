/**
 * Activation seam for the `:::name` directive primitive. Importing this module
 * registers the generic fallback kinds, the shared block opener, and the inline
 * `:` recognizer at load — nothing else in the library imports it, so a consumer
 * that never touches directives leaves `:::` and `:` unclaimed. Deterministic
 * module-load registration (not lazy on first `registerDirective`) reconciles
 * with G1.17: the opener must land before the grammar-consumed latch trips, or
 * already-parsed documents would not re-parse. All calls are idempotent for HMR.
 */

import { registerDirectiveKinds, registerDirectiveTextKind, DIRECTIVE_TEXT } from './kinds';
import { registerDirectiveOpeners } from './container-opener';
import { declaredPluginInlineKind } from '../../schema/plugin-kind';
import { getInlineSyntax, registerInlineSyntax } from '../inline/scan/plugin-syntax';
import { recognizeTextDirective } from './text-recognizer';

registerDirectiveKinds();
registerDirectiveOpeners();

registerDirectiveTextKind();
if (getInlineSyntax(':') === undefined) {
	const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
	registerInlineSyntax(':', (raw, pos, end) => recognizeTextDirective(raw, pos, end, kind));
}
