/**
 * The checks `check` runs, by the published name an author excuses one by: what each holds a plugin
 * to, the subject it runs on, and whether an excuse may cover it. A check this release only reports
 * carries `advisory`; its failure reads `advisory` until it does fail.
 */

import { CONTAINER_CELL_CONTRACTS, KIND_CELL_CONTRACTS, type CellContract } from './cell-contracts';

type PluginCheck = 'install' | 'setup';
type BlockCheck =
	| 'sample'
	| 'roundTrip'
	| 'mergeBackspace'
	| 'clipboard'
	| 'undo'
	| 'search'
	| 'searchPaint'
	| 'rawWrite'
	| 'unfinishedReading'
	| 'focus'
	| 'selectionPaint'
	| 'reorder'
	| 'simOracle';
type ContainerCheck =
	'localIndex' | 'ancestry' | 'focusBubble' | 'openerLine' | 'containerCopy' | 'containerDeclared';
type InlineCheck = never;

/** A check `check` runs: a row names the one it ran, and an excuse the one it covers. */
export type CheckName = PluginCheck | BlockCheck | ContainerCheck | InlineCheck;

type ExcusableCheck =
	'mergeBackspace' | 'clipboard' | 'undo' | 'localIndex' | 'focusBubble' | 'openerLine';

/** A reason per check an excuse may cover; where a subject has none, no key compiles. */
export type Excused<C extends CheckName> = [Extract<C, ExcusableCheck>] extends [never]
	? { readonly [name: string]: never }
	: { readonly [K in Extract<C, ExcusableCheck>]?: string };

export type { PluginCheck, BlockCheck, ContainerCheck, InlineCheck };

/** The guide's section every check's failure points to. */
const ANCHOR = 'checking-a-plugin-value-check';

interface CheckSpec<C extends CheckName> {
	of: 'plugin' | 'block' | 'container';
	excusable: C extends ExcusableCheck ? true : false;
	advisory?: true;
	contract: CellContract;
}

const promise = (text: string): CellContract => ({ promise: text, anchor: ANCHOR });
const kind = (cell: keyof typeof KIND_CELL_CONTRACTS) => promise(KIND_CELL_CONTRACTS[cell].promise);
const box = (cell: keyof typeof CONTAINER_CELL_CONTRACTS) =>
	promise(CONTAINER_CELL_CONTRACTS[cell].promise);

export const CHECKS: { readonly [C in CheckName]: CheckSpec<C> } = {
	install: {
		of: 'plugin',
		excusable: false,
		contract: promise(
			'your plugin installs with its defaults and with your options, with no problem and no dev warning'
		)
	},
	setup: {
		of: 'plugin',
		excusable: false,
		contract: promise('your setup runs against an editor, and so does the function it returns')
	},
	sample: {
		of: 'block',
		excusable: false,
		contract: promise('each block type has a sample, and each reads as that type first')
	},
	roundTrip: { of: 'block', excusable: false, contract: kind('roundTrip') },
	mergeBackspace: { of: 'block', excusable: true, contract: kind('mergeBackspace') },
	clipboard: { of: 'block', excusable: true, contract: kind('clipboard') },
	undo: { of: 'block', excusable: true, contract: kind('undo') },
	search: { of: 'block', excusable: false, contract: kind('searchPaint') },
	searchPaint: {
		of: 'block',
		excusable: false,
		contract: promise('a search match in your block is painted where it is')
	},
	rawWrite: { of: 'block', excusable: false, contract: kind('rawWrite') },
	unfinishedReading: { of: 'block', excusable: false, contract: kind('unfinishedReading') },
	focus: { of: 'block', excusable: false, contract: kind('focus') },
	selectionPaint: { of: 'block', excusable: false, contract: kind('selectionPaint') },
	reorder: { of: 'block', excusable: false, contract: kind('reorder') },
	simOracle: { of: 'block', excusable: false, contract: kind('simOracle') },
	localIndex: { of: 'container', excusable: true, contract: box('localIndex') },
	ancestry: { of: 'container', excusable: false, contract: box('ancestry') },
	focusBubble: { of: 'container', excusable: true, contract: box('focusBubble') },
	openerLine: { of: 'container', excusable: true, contract: box('openerLine') },
	containerCopy: { of: 'container', excusable: false, contract: box('copyMarkers') },
	containerDeclared: {
		of: 'container',
		excusable: false,
		contract: promise('your line shape reads back every marker and line it writes')
	}
};

/** Whether `name` is a check `check` runs, for an excuse a JavaScript author spelled. */
export const isCheckName = (name: string): name is CheckName => Object.hasOwn(CHECKS, name);
