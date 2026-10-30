/**
 * G1.165: a container dispatches its kind chords only from an element marked with its kind, or
 * `claimsChord` would tell a host the chord is free where the container takes it.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkContainerChordMark(
	markedKind: string | null,
	kind: string
): InvariantViolation | null {
	if (markedKind === kind) return null;
	return {
		code: 'container-chords-unmarked',
		message: `a ${kind} container took a chord from an element claimsChord cannot see: bind handleKeydown on the box the factory was given, or install it with listenForContainerChords`,
		detail: { kind, markedKind }
	};
}
