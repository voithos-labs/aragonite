/**
 * G1.52: the text the editor serves for an unchanged content version is still the document's
 * serialization. A byte writer that skipped the version bump would leave `getSource()` stale.
 */

import type { InvariantViolation } from '../assert';
import type { Document } from '../core/nodes';
import { serialize } from '../core/serializer';

export function checkCurrentSource(served: string, doc: Document): InvariantViolation | null {
	if (served === serialize(doc)) return null;
	return {
		code: 'current-source-stale',
		message:
			'the text served for this content version no longer matches the document: a write changed its bytes without bumping the content version'
	};
}
