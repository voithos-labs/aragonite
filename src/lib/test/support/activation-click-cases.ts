// Every (host gesture, mode, Ctrl state) a click on a link can arrive in, with whether it follows,
// written out by hand so each route's test checks against the rule rather than its own copy.
import type { LinkClick } from '#lib/activation-click.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

export interface ActivationClickCase {
	name: string;
	linkClick: LinkClick;
	mode: PresentationMode;
	modified: boolean;
	follows: boolean;
}

const MODES: PresentationMode[] = ['source', 'preview-block', 'preview-inline', 'live', 'reading'];

// Reading mode has no caret to place, so any click follows there; the host's plain gesture
// reaches live mode only, the editable mode that never shows a link's syntax.
function follows(linkClick: LinkClick, mode: PresentationMode, modified: boolean): boolean {
	if (modified || mode === 'reading') return true;
	return linkClick === 'plain' && mode === 'live';
}

export const ACTIVATION_CLICK_CASES: ActivationClickCase[] = (['modifier', 'plain'] as const)
	.flatMap((linkClick) => MODES.map((mode) => ({ linkClick, mode })))
	.flatMap(({ linkClick, mode }) =>
		[false, true].map((modified) => ({
			name: `${linkClick} host, ${modified ? 'Ctrl-click' : 'plain click'} in ${mode}`,
			linkClick,
			mode,
			modified,
			follows: follows(linkClick, mode, modified)
		}))
	);
