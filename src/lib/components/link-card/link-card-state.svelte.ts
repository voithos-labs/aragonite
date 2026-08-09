// The open link card's target. Identity only — path plus construct start — because every commit
// rebuilds the inline tree, so a captured node would address bytes that moved.

import type { LinkTarget } from '../blocks/text/link-at-point';

export interface LinkCardState {
	getTarget(): LinkTarget | null;
	open(target: LinkTarget): void;
	close(): void;
}

export function createLinkCardState(): LinkCardState {
	let target = $state<LinkTarget | null>(null);

	return {
		getTarget: () => target,
		open: (next) => {
			target = { path: [...next.path], sourceStart: next.sourceStart };
		},
		close: () => {
			target = null;
		}
	};
}
