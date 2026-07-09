/**
 * Activation seam for the `:::name` directive primitive. Importing this module
 * registers the generic fallback kinds and the shared opener at load — nothing
 * else in the library imports it, so a consumer that never touches directives
 * leaves `:::` unclaimed. Deterministic module-load registration (not lazy on
 * first `registerDirective`) reconciles with G1.17: the opener must land before
 * the grammar-consumed latch trips, or already-parsed documents would not
 * re-parse. Both calls are idempotent for HMR re-import.
 */

import { registerDirectiveKinds } from './kinds';
import { registerDirectiveOpeners } from './container-opener';

registerDirectiveKinds();
registerDirectiveOpeners();
