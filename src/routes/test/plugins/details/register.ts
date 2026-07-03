/**
 * Idempotent registration of the `<details>` collapsible: the model layer (kind
 * + chrome summary + opener) plus the `DetailsBlock` component. Safe to import
 * more than once — the kind and component registrations guard on live registry
 * state (HMR / re-import). The reserved child-0 `details-summary` chrome leaf is
 * registered by `registerDetailsKind` via `registerChromeLeaf`.
 */

import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	type AnyBlockKind
} from '$lib/plugin';
import { registerDetailsKind, DETAILS } from './details-kind';
import DetailsBlock from './DetailsBlock.svelte';

export function registerDetails(): void {
	registerDetailsKind();
	if (!isBlockComponentRegistered(DETAILS)) {
		registerBlockComponent(DETAILS as AnyBlockKind, defineBlockComponent(DetailsBlock));
	}
}
