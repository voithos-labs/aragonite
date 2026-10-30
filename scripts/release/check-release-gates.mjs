#!/usr/bin/env node
// Refuses a release while any engine check still reports without gating: every engine the CI runs
// gates `main` before a version ships. Runs inside `npm run release:publish`.
import { PENDING_GATE_CONTEXTS } from './branch-protection-contexts.mjs';

if (PENDING_GATE_CONTEXTS.length > 0) {
	console.error(
		`release refused: ${PENDING_GATE_CONTEXTS.length} engine check(s) don't gate main yet ` +
			'(PENDING_GATE_CONTEXTS in scripts/release/branch-protection-contexts.mjs):\n  ' +
			PENDING_GATE_CONTEXTS.join('\n  ')
	);
	process.exit(1);
}
