/**
 * G1.245: a closed container's body holds no collapsed caret. Every landing resolves its caret on
 * the tree first (`selection/caret-target.ts`), which puts one aimed at a closed body on the title
 * row; a range's end may still sit in a body a fold closed over it. A restored caret is checked
 * here; a landing never reaches one, since a hidden body is not mounted.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView } from '../core/node-views';

/** `hidingOf` finds the closed container whose body holds a path, or null: the selection's own. */
export function checkNoCaretInClosedBody(
	doc: DocumentView,
	leafPath: readonly number[],
	hidingOf: (doc: DocumentView, path: readonly number[]) => number[] | null
): InvariantViolation | null {
	const hiding = hidingOf(doc, leafPath);
	if (!hiding) return null;
	return {
		code: 'closed-body-caret',
		message: `a caret landed at [${leafPath}], in the body the closed container at [${hiding}] hides: land it on the title row`,
		detail: { path: [...leafPath], container: hiding }
	};
}
