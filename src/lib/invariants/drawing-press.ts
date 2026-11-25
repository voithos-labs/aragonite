/**
 * G1.252: a press that starts inside a block type's drawing reaches the editor. The drawing is
 * mounted inside the editor, so a press its component stops never reaches the editor's own
 * handlers; a drawing claims a press with `Drawn.keep` instead.
 */
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** `stopped` names the presses a drawing of `kind` kept from the editor. */
export function checkPressReachedEditor(
	stopped: readonly string[],
	kind: string
): InvariantViolation | null {
	if (stopped.length === 0) return null;
	return {
		code: 'press-reaches-editor',
		message: `a ${stopped.join(' and ')} inside a "${kind}" drawing never reached the editor; claim it with \`keep\`, not \`stopPropagation\``
	};
}
