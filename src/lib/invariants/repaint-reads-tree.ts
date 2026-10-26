/**
 * G1.150: after a block repaints from its bytes (a write the tree took back), its element reads
 * back as those bytes, so a character the browser typed into a rolled-back keystroke is gone.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkRepaintReadsTree(shown: string, stored: string): InvariantViolation | null {
	return shown === stored
		? null
		: {
				code: 'repaint-reads-tree',
				message: `a repainted block shows ${JSON.stringify(shown)} for the bytes ${JSON.stringify(stored)}`
			};
}
