/**
 * G1.132: a delete the editor decides never reaches `input` undecided. Its `beforeinput` was
 * decided and prevented, or declined with a named reason; anything else is a surface that let the
 * browser's own delete through.
 */

import type { DeleteVerdict } from '../caret/delete-extent';
import { decidedDelete } from '../browser/input';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkDeleteDecided(
	e: Pick<InputEvent, 'inputType'>,
	verdict: DeleteVerdict | null
): InvariantViolation | null {
	const intent = decidedDelete(e);
	if (intent === null) return null;
	if (verdict && !verdict.decided) return null;
	const name = `${intent.direction} ${intent.unit} delete`;
	return {
		code: verdict ? 'delete-not-prevented' : 'delete-never-decided',
		message: verdict
			? `the editor wrote a ${name} and the browser's delete ran too`
			: `a ${name} reached input without the editor's delete step deciding it`,
		detail: { ...intent }
	};
}
