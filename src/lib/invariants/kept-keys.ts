/**
 * G1.230: the answers a surface's `depends` keeps across writes equal asking every top-level block
 * again. The watch asks only the blocks a write's runs replaced, so a difference means a write
 * under-reported what it changed, or a `depends` answered from more than its block's own content
 * (its place in the document, another block), which moves with no write to the block.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkKeptKeys(
	kept: readonly string[],
	fresh: readonly string[]
): InvariantViolation | null {
	if (kept.length !== fresh.length) {
		return keptKeys(
			`the kept answers name ${kept.length} blocks, the document holds ${fresh.length}`
		);
	}
	const at = fresh.findIndex((key, i) => key !== kept[i]);
	if (at < 0) return null;
	return keptKeys(
		`block ${at} answers ${JSON.stringify(fresh[at])}, kept as ${JSON.stringify(kept[at])}: ` +
			'a write changed it unsaid, or `depends` reads more than the block (its place, another block)'
	);
}

function keptKeys(message: string): InvariantViolation {
	return { code: 'kept-keys', message };
}
