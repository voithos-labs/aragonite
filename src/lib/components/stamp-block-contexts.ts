/**
 * Stamps every write handle a block reaches through context with the document the block mounted
 * on. `BlockHost` calls it during init, so a block component, and any container or plugin factory
 * it builds, never holds an unstamped handle: a write it makes after a `source` swap is refused.
 */

import { getContext, setContext } from 'svelte';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorServices
} from '../editor-keys';
import { stampWrites } from '../editor-actions/commit/document-stamp';

const ACTION_KEYS = [BLOCK_EDIT_KEY, FOCUS_KEY, CONTAINER_EDIT_KEY, HISTORY_KEY];

export function stampBlockContexts(services: EditorServices): void {
	const { stamps } = services;
	const stamp = stamps.current();
	// A partial test mount leaves some handles out.
	const stamped = <T>(handles: T): T =>
		handles && typeof handles === 'object' ? stampWrites(handles, stamp, stamps) : handles;
	for (const key of ACTION_KEYS) {
		const handles = getContext<object | undefined>(key);
		if (handles) setContext(key, stamped(handles));
	}
	// The services object stays shared below; only its writers are swapped for stamped ones.
	const blockServices: EditorServices = Object.create(services);
	blockServices.controller = stamped(services.controller);
	blockServices.pasteCoordinator = stamped(services.pasteCoordinator);
	blockServices.reorder = stamped(services.reorder);
	setContext(EDITOR_SERVICES_KEY, blockServices);
}
