/**
 * The checks `check` runs, by the published name an author excuses one by: what each holds a plugin
 * to on each kind of subject it runs on, and whether an excuse may cover it. A name may run on two
 * kinds (`roundTrip` on a block type and on an inline), each with its own promise. A check this
 * release only reports carries `advisory`; its failure reads `advisory` until it does fail.
 */

import { CONTAINER_CELL_CONTRACTS, KIND_CELL_CONTRACTS, type CellContract } from './cell-contracts';

type PluginCheck = 'install' | 'setup' | 'paintRanges' | 'codeTokens';
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
	| 'simOracle'
	| 'completion'
	| 'dataWriteback'
	| 'docPositions';
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
type CommandCheck = 'waitingWrite' | 'actionTarget';
type MenuCheck = 'waitingWrite';
type RewriteCheck = 'rewriteLands';

/** A check `check` runs: a row names the one it ran, and an excuse the one it covers. */
export type CheckName =
	PluginCheck | BlockCheck | ContainerCheck | InlineCheck | CommandCheck | RewriteCheck;

type ExcusableCheck =
	| 'mergeBackspace'
	| 'clipboard'
	| 'undo'
	| 'localIndex'
	| 'focusBubble'
	| 'openerLine'
	| 'widget'
	| 'editingPolicy'
	| 'waitingWrite'
	| 'actionTarget'
	| 'completion';

/** A reason per check an excuse may cover; where a subject has none, no key compiles. */
export type Excused<C extends CheckName> = [Extract<C, ExcusableCheck>] extends [never]
	? { readonly [name: string]: never }
	: { readonly [K in Extract<C, ExcusableCheck>]?: string };

export type {
	PluginCheck,
	BlockCheck,
	ContainerCheck,
	InlineCheck,
	CommandCheck,
	MenuCheck,
	RewriteCheck
};

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
		readonly command?: CellContract;
		readonly menu?: CellContract;
		readonly blockRewrite?: CellContract;
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
// A kit's sentence is borrowed where it holds for a plugin value; one naming what only a `setup`
// plugin writes (a fixture, a merge role) is worded here in the plugin value's own terms.
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
				'your plugin installs with its defaults and with your options, with no problem and no dev warning; where you hand options, its defaults may fail its own validate'
			)
		}
	},
	setup: {
		excusable: false,
		contract: {
			plugin: promise('your setup runs against an editor, and so does the function it returns')
		}
	},
	paintRanges: {
		excusable: false,
		contract: {
			plugin: promise(
				'each paint you answer for a block lands inside it, where the editor can draw it'
			)
		}
	},
	codeTokens: {
		excusable: false,
		contract: {
			plugin: promise(
				'your tokens for a language you list nest inside the body, none crossing another'
			)
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
			block: promise('your samples read back to their exact bytes'),
			inline: promise(
				'your samples, and each line holding a claim beside any neighbour, read back to their bytes'
			)
		}
	},
	mergeBackspace: {
		excusable: true,
		contract: {
			block: promise(
				'Backspace merges into your block only as its `role`, or a container’s `joins`, says'
			)
		}
	},
	clipboard: { excusable: true, contract: kind('clipboard') },
	undo: { excusable: true, contract: kind('undo') },
	search: { excusable: false, contract: kind('searchPaint') },
	searchPaint: {
		excusable: false,
		contract: { block: promise('a search match in your block is painted where it is') }
	},
	rawWrite: { excusable: false, contract: kind('rawWrite') },
	unfinishedReading: {
		excusable: false,
		contract: {
			block: promise(
				'your block, typed with no closing line yet, gives the rest of the document back once it closes'
			)
		}
	},
	focus: { excusable: false, contract: kind('focus') },
	selectionPaint: { excusable: false, contract: kind('selectionPaint') },
	reorder: { excusable: false, contract: kind('reorder') },
	simOracle: { excusable: false, contract: kind('simOracle') },
	localIndex: { excusable: true, contract: box('localIndex') },
	ancestry: { excusable: false, contract: box('ancestry') },
	focusBubble: { excusable: true, contract: box('focusBubble') },
	openerLine: {
		excusable: true,
		contract: {
			block: promise(
				'typing your sample’s first line above a block, a character at a time, keeps the caret on a line it can type in'
			)
		}
	},
	containerCopy: { excusable: false, contract: box('copyMarkers') },
	containerDeclared: {
		excusable: false,
		contract: { block: promise('your line shape reads back every marker and line it writes') }
	},
	completion: {
		excusable: true,
		contract: {
			block: promise(
				'a prefix of your sample completes into lines that read as your type, the caret inside them'
			)
		}
	},
	dataWriteback: {
		excusable: false,
		contract: { block: promise('the data read from a block writes back to the same bytes') }
	},
	docPositions: {
		excusable: false,
		contract: {
			block: promise(
				'each block of your type sits at the bytes it reads, its text inside its line, its pieces inside it'
			)
		}
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
	},
	waitingWrite: {
		excusable: true,
		contract: {
			command: promise('a command that waits writes nothing once the host loads another note'),
			menu: promise('a pick that waits writes nothing once the host loads another note')
		}
	},
	actionTarget: {
		excusable: true,
		contract: {
			command: promise('a block command writes the block it is handed, not the one at the caret')
		}
	},
	rewriteLands: {
		excusable: false,
		contract: {
			blockRewrite: promise(
				'a rewrite’s answer lands as blocks of its own, leaving the blocks above and after it and the container around it, and a paste of it is not rewritten again'
			)
		}
	}
};

/** Whether `name` is a check `check` runs, for an excuse a JavaScript author spelled. */
export const isCheckName = (name: string): name is CheckName => Object.hasOwn(CHECKS, name);

/** What `check` holds a plugin to on a subject of kind `of`. */
export const contractOf = (check: CheckName, of: string): CellContract | undefined =>
	(CHECKS[check]?.contract as Partial<Record<string, CellContract>> | undefined)?.[of];
