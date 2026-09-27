/**
 * Field pairs a block-kind registration can't mean together. The registration types refuse each
 * one; this table refuses it again at runtime for a caller the types never reach (a cast, plain
 * JavaScript). A new row needs a `@ts-expect-error [id]` pin in `descriptor-groups.types.test.ts`.
 */
import type { AnyBlockKind } from '../core/nodes';

/** The registration fields the pairs read, loose enough to hold what a cast lets through. */
interface RegistrationFields {
	blockFocus?: string;
	supportsInline?: boolean;
	contentStart?: { range?: unknown };
	container?: {
		reservedChrome?: unknown;
		unwrapRole?: { firstChildBackspace?: string };
	};
}

interface IncoherentPair {
	id: string;
	fields: string;
	reason: string;
	holds: (registration: RegistrationFields) => boolean;
}

const wholeBlock = (r: RegistrationFields): boolean => r.blockFocus === 'whole-block';

export const INCOHERENT_REGISTRATION_PAIRS = [
	{
		id: 'content-start-without-range',
		fields: 'contentStart with no contentStart.range',
		reason: 'the content-start Backspace reads the range, so it would never fire',
		holds: (r) => r.contentStart !== undefined && typeof r.contentStart.range !== 'function'
	},
	{
		id: 'whole-block-inline',
		fields: "blockFocus: 'whole-block' with supportsInline",
		reason: 'a block focused as one unit has no caret positions for inline content to live at',
		holds: (r) => wholeBlock(r) && r.supportsInline === true
	},
	{
		id: 'whole-block-content-start',
		fields: "blockFocus: 'whole-block' with contentStart",
		reason: "no caret enters a block focused as one unit, so there's no content start",
		holds: (r) => wholeBlock(r) && r.contentStart !== undefined
	},
	{
		id: 'whole-block-title-row',
		fields: "blockFocus: 'whole-block' with container.reservedChrome",
		reason: 'a title row means the block is never childless, so whole-block focus never engages',
		holds: (r) => wholeBlock(r) && r.container?.reservedChrome !== undefined
	},
	{
		id: 'title-row-first-child-strategy',
		fields: 'container.reservedChrome with unwrapRole.firstChildBackspace',
		reason: 'Backspace at a title row always keeps it, so declare only middleChildBackspace',
		holds: (r) =>
			r.container?.reservedChrome !== undefined &&
			r.container.unwrapRole?.firstChildBackspace !== undefined
	},
	{
		id: 'keep-title-row-without-one',
		fields: "firstChildBackspace: 'keep-reserved-chrome' with no container.reservedChrome",
		reason: 'child 0 is body, so Backspace at its start would do nothing; declare a lifting one',
		holds: (r) =>
			r.container?.reservedChrome === undefined &&
			r.container?.unwrapRole?.firstChildBackspace === 'keep-reserved-chrome'
	}
] as const satisfies readonly IncoherentPair[];

export type IncoherentPairId = (typeof INCOHERENT_REGISTRATION_PAIRS)[number]['id'];

export function rejectIncoherentPairs(kind: AnyBlockKind, registration: RegistrationFields): void {
	for (const pair of INCOHERENT_REGISTRATION_PAIRS) {
		if (!pair.holds(registration)) continue;
		throw new Error(`registerBlockKind: "${kind}" declares ${pair.fields}; ${pair.reason}`);
	}
}
