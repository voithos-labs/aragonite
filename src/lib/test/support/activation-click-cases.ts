// Every (host gesture, mode, Ctrl state, click count) a click on a link can arrive in, with whether
// it follows, written out by hand so each route's test checks against the rule, not its own copy.
import type { LinkClick } from '#lib/activation-click.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

export interface ActivationClickCase {
	name: string;
	linkClick: LinkClick;
	mode: PresentationMode;
	modified: boolean;
	/** `MouseEvent.detail`: 2 is the second press of a double-click. */
	detail: number;
	follows: boolean;
}

const MODES: PresentationMode[] = ['source', 'preview-block', 'preview-inline', 'live', 'reading'];

// Reading mode has no caret to place, so any click follows there; the host's plain gesture
// reaches live mode only, the editable mode that never shows a link's syntax. A double-click's
// second press never follows: the first one already did.
function follows(
	linkClick: LinkClick,
	mode: PresentationMode,
	modified: boolean,
	detail: number
): boolean {
	if (detail > 1) return false;
	if (modified || mode === 'reading') return true;
	return linkClick === 'plain' && mode === 'live';
}

export const ACTIVATION_CLICK_CASES: ActivationClickCase[] = (['modifier', 'plain'] as const)
	.flatMap((linkClick) => MODES.map((mode) => ({ linkClick, mode })))
	.flatMap(({ linkClick, mode }) =>
		[false, true].map((modified) => ({ linkClick, mode, modified }))
	)
	.flatMap(({ linkClick, mode, modified }) =>
		[1, 2].map((detail) => ({
			name: `${linkClick} host, ${modified ? 'Ctrl-' : 'plain '}${detail === 2 ? 'double-click' : 'click'} in ${mode}`,
			linkClick,
			mode,
			modified,
			detail,
			follows: follows(linkClick, mode, modified, detail)
		}))
	);
