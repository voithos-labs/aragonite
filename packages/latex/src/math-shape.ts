/**
 * The `$$` fence, spelled once: the block type declares it, the editor reads and writes it, and
 * every writer of a new block (the insert row, the completion) gives it these lines.
 */
import type { Fence } from '@voithos-labs/aragonite/plugin';

const BLOCK_FENCE = '$$';

/** On lines of its own, or the whole block on one line (`$$x^2$$`). */
export const DOLLAR_FENCE: Fence = { open: /\$\$/, close: BLOCK_FENCE, oneLine: true };

/** A line holding the fence alone, which can only open the multi-line form. */
export const LONE_FENCE = /^[ \t]*\$\$[ \t]*$/;

/** The multi-line form's lines around `body`. */
export const mathBlockLines = (body: string): string[] => [BLOCK_FENCE, body, BLOCK_FENCE];

/** Each form the block type reads, for the published checks. */
export const BLOCK_SAMPLES = [
	mathBlockLines('x^2').join('\n'),
	'```math\nx^2\n```',
	`${BLOCK_FENCE}x^2${BLOCK_FENCE}`
];
