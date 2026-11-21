/**
 * What the plugins on one editor claim that two can't share: a `:::` name, an inline prefix, a
 * chord. The editor's install pass feeds it each plugin's claims in list order; list order settles a
 * contested claim, as it does a conflict, and a chord the editor takes everywhere (search, undo,
 * redo) is never a plugin's.
 */
import { GLOBAL_KEYMAP, isReservedUiChord } from './commands';
import { chordDefect, isTextKey, normalizeChord } from './keybindings';
import { keepFirstListed, type PluginError } from './plugin-unit';

export interface PluginClaims {
	readonly colons?: readonly string[];
	readonly prefixes?: readonly string[];
	readonly chords?: readonly string[];
	/** Keys the plugin's leaf block types take in themselves: refused as a chord is, and contested
	 *  with another plugin's chord, though two plugins' types may share one. */
	readonly blockKeys?: readonly string[];
	/** Keys its container types take, as `blockKeys`, never one the text inside edits with. */
	readonly containerKeys?: readonly string[];
}

/** The plugins to leave out, each reported once with the claim it lost. */
export function refusedClaims(
	claimants: readonly { readonly plugin: string; readonly claims: PluginClaims }[],
	report: (error: PluginError) => void
): Set<string> {
	const valid = claimants.flatMap(({ plugin, claims }) => {
		const list = claimList(claims);
		const problem = list.map(problemWith).find((p) => p !== null);
		if (problem === undefined) return [{ name: plugin, list }];
		report({ plugin, doing: 'install', cause: new Error(`plugin '${plugin}' ${problem}`) });
		return [];
	});
	const kept = new Set(keepFirstListed(valid, sharedClaim, report).map((c) => c.name));
	return new Set(claimants.map((c) => c.plugin).filter((name) => !kept.has(name)));
}

// ── Internal ─────────────────────────────────────────────────────────────────

const CLAIMED = [
	['colons', 'the `:::` name'],
	['prefixes', 'the inline prefix'],
	['chords', 'the chord'],
	['blockKeys', 'the block key'],
	['containerKeys', 'the block key']
] as const;

interface Claim {
	label: (typeof CLAIMED)[number][1];
	raw: string;
	/** What two plugins' claims are compared by: a chord spelled the one way the keymap spells it. */
	key: string;
	defect: string | null;
	onContainer: boolean;
}

function claimList(claims: PluginClaims): Claim[] {
	return CLAIMED.flatMap(([field, label]) =>
		(claims[field] ?? []).map((raw) => {
			const keyed = field !== 'colons' && field !== 'prefixes';
			const defect = keyed ? chordDefect(raw) : null;
			const key = keyed && defect === null ? normalizeChord(raw) : raw;
			return { label, raw, key, defect, onContainer: field === 'containerKeys' };
		})
	);
}

function problemWith({ label, raw, key, defect, onContainer }: Claim): string | null {
	if (defect !== null) return `claims ${label} "${raw}", which isn't one: ${defect}`;
	if (label !== 'the chord' && label !== 'the block key') return null;
	if (isReservedUiChord(key)) return `claims ${label} "${raw}", which search takes`;
	if (GLOBAL_KEYMAP.some((binding) => binding.chord === key))
		return `claims ${label} "${raw}", which undo or redo takes`;
	// Tab moves focus on from a block focused whole and through reading mode; no type may hold it.
	if (label === 'the block key' && (key === 'Tab' || key === 'Shift+Tab'))
		return `claims ${label} "${raw}", which the page keeps for moving focus`;
	// A container's key would beat the text of every block inside it, where nothing binds the key.
	if (onContainer && isTextKey(key))
		return `claims ${label} "${raw}" on a container, which the text inside it keeps`;
	return null;
}

function sharedClaim(later: { list: Claim[] }, first: { list: Claim[] }): string | null {
	const shared = later.list.find((c) =>
		first.list.some((o) => o.key === c.key && contested(c.label, o.label))
	);
	return shared ? `shares ${shared.label} "${shared.raw}" with` : null;
}

// Each block type takes its own keys in itself, so two plugins' types never contest one; a type's
// key and a command's chord are one key inside that type's blocks.
function contested(a: Claim['label'], b: Claim['label']): boolean {
	if (a === b) return a !== 'the block key';
	return [a, b].every((label) => label === 'the chord' || label === 'the block key');
}
