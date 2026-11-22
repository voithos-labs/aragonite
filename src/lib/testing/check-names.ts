/**
 * The checks `check` runs, by the published name an author excuses one by: what each holds a plugin
 * to on each kind of subject it runs on, and whether an excuse may cover it. A name may run on two
 * kinds (`roundTrip` on a block type and on an inline), each with its own promise. A check this
 * release only reports carries `advisory`; its failure reads `advisory` until it does fail.
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
type InlineCheck =
	| 'sample'
	| 'claims'
	| 'roundTrip'
	| 'inlineDecline'
	| 'widget'
	| 'editingPolicy'
	| 'inlineWriter'
	| 'inlinePlace'
	| 'dependsContent'
	| 'pairSides';

/** A check `check` runs: a row names the one it ran, and an excuse the one it covers. */
export type CheckName = PluginCheck | BlockCheck | ContainerCheck | InlineCheck;

type ExcusableCheck =
	| 'mergeBackspace'
	| 'clipboard'
	| 'undo'
	| 'localIndex'
	| 'focusBubble'
	| 'openerLine'
	| 'widget'
	| 'editingPolicy';

/** A reason per check an excuse may cover; where a subject has none, no key compiles. */
export type Excused<C extends CheckName> = [Extract<C, ExcusableCheck>] extends [never]
	? { readonly [name: string]: never }
	: { readonly [K in Extract<C, ExcusableCheck>]?: string };

export type { PluginCheck, BlockCheck, ContainerCheck, InlineCheck };

/** The guide's section every check's failure points to. */
const ANCHOR = 'checking-a-plugin-value-check';

interface CheckSpec<C extends CheckName> {
	excusable: C extends ExcusableCheck ? true : false;
	advisory?: true;
	/** What it holds a plugin to, by the kind of subject a row names; a container's rows are a
	 *  block's. */
	contract: {
		readonly plugin?: CellContract;
		readonly block?: CellContract;
		readonly inline?: CellContract;
	};
}

// Each helper the table calls is marked pure: a host importing `configureEditorEnv` from `/testing`
// would otherwise ship the table (G4.375).
/* @__NO_SIDE_EFFECTS__ */
function promise(text: string): CellContract {
	return { promise: text, anchor: ANCHOR };
}

/* @__NO_SIDE_EFFECTS__ */
function kitPromise<C extends string>(table: Record<C, CellContract>, cell: C): CellContract {
	return promise(table[cell].promise);
}
const kind = (cell: keyof typeof KIND_CELL_CONTRACTS) => ({
	block: kitPromise(KIND_CELL_CONTRACTS, cell)
});
const box = (cell: keyof typeof CONTAINER_CELL_CONTRACTS) => ({
	block: kitPromise(CONTAINER_CELL_CONTRACTS, cell)
});
const inline = (text: string) => ({ inline: promise(text) });

export const CHECKS: { readonly [C in CheckName]: CheckSpec<C> } = {
	install: {
		excusable: false,
		contract: {
			plugin: promise(
				'your plugin installs with its defaults and with your options, with no problem and no dev warning'
			)
		}
	},
	setup: {
		excusable: false,
		contract: {
			plugin: promise('your setup runs against an editor, and so does the function it returns')
		}
	},
	sample: {
		excusable: false,
		contract: {
			block: promise('each block type has a sample, and each reads as that type first'),
			inline: promise('each inline construct has a sample')
		}
	},
	roundTrip: {
		excusable: false,
		contract: {
			block: kitPromise(KIND_CELL_CONTRACTS, 'roundTrip'),
			inline: promise(
				'your samples, and each line holding a claim beside any neighbour, read back to their bytes'
			)
		}
	},
	mergeBackspace: { excusable: true, contract: kind('mergeBackspace') },
	clipboard: { excusable: true, contract: kind('clipboard') },
	undo: { excusable: true, contract: kind('undo') },
	search: { excusable: false, contract: kind('searchPaint') },
	searchPaint: {
		excusable: false,
		contract: { block: promise('a search match in your block is painted where it is') }
	},
	rawWrite: { excusable: false, contract: kind('rawWrite') },
	unfinishedReading: { excusable: false, contract: kind('unfinishedReading') },
	focus: { excusable: false, contract: kind('focus') },
	selectionPaint: { excusable: false, contract: kind('selectionPaint') },
	reorder: { excusable: false, contract: kind('reorder') },
	simOracle: { excusable: false, contract: kind('simOracle') },
	localIndex: { excusable: true, contract: box('localIndex') },
	ancestry: { excusable: false, contract: box('ancestry') },
	focusBubble: { excusable: true, contract: box('focusBubble') },
	openerLine: { excusable: true, contract: box('openerLine') },
	containerCopy: { excusable: false, contract: box('copyMarkers') },
	containerDeclared: {
		excusable: false,
		contract: { block: promise('your line shape reads back every marker and line it writes') }
	},
	claims: {
		excusable: false,
		contract: inline('every sample holds a claim of your construct, starting at its prefix')
	},
	inlineDecline: {
		excusable: false,
		contract: inline(
			"a claim of yours at a bracket gives way where the editor's own link or image closes inside it"
		)
	},
	widget: {
		excusable: true,
		contract: inline('your widget is one unit over exactly its bytes, and they read alone')
	},
	editingPolicy: {
		excusable: true,
		contract: inline(
			'your widget edits as its fields say, and deleting it whole leaves bytes that read back'
		)
	},
	inlineWriter: {
		excusable: false,
		contract: inline("your write gives a claim's bytes back from what was read out of them")
	},
	inlinePlace: {
		excusable: false,
		contract: inline('`after` names a construct it can follow, and no two follow each other')
	},
	dependsContent: {
		excusable: false,
		contract: inline('depends answers from the block alone, the same wherever the block stands')
	},
	pairSides: {
		excusable: false,
		contract: inline(
			'each side of your pair reads on its own, and both sides of one pair read one key'
		)
	}
};

/** Whether `name` is a check `check` runs, for an excuse a JavaScript author spelled. */
export const isCheckName = (name: string): name is CheckName => Object.hasOwn(CHECKS, name);

/** What `check` holds a plugin to on a subject of kind `of`. */
export const contractOf = (check: CheckName, of: string): CellContract | undefined =>
	(CHECKS[check]?.contract as Partial<Record<string, CellContract>> | undefined)?.[of];
