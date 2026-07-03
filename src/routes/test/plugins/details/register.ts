/**
 * Idempotent registration of the `<details>` collapsible. Task 2 registers only
 * the model layer (kind + chrome summary + opener); the `DetailsBlock` component
 * lands in Task 4 and wires in here. Safe to import more than once — the kind
 * registration guards on the live registry state (HMR / re-import).
 */

import { registerDetailsKind } from './details-kind';

export function registerDetails(): void {
	registerDetailsKind();
}
