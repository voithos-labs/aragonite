/** What a directive container's raw bytes and body wrap carry, shared by its opener and its kind. */

import type { ContainerBodyWrap } from '../parser';

/** The `:::` opener and closer bracket every directive body, whatever kind the name maps to. */
export const DIRECTIVE_BODY_WRAP: ContainerBodyWrap = {
	afterOpenerLine: true,
	beforeCloserLine: true
};

/** The generic container's kind, and the kind of every `:::` container's first child: its opener
 *  line, which the grammar builds and the rebuild writes back as it stands. */
export const DIRECTIVE_CONTAINER = 'directiveContainer';
export const DIRECTIVE_OPENER_LINE = 'directiveOpenerLine';

/** The closing-line bytes a generic container keeps; the opener line is its first child. */
export interface DirectiveContainerMetadata {
	name: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	/** Authored line ending for the opener and closer fence lines. */
	lineEnding: string;
}
