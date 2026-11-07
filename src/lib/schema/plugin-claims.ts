/**
 * What the plugins on one editor claim that two can't share: a `:::` name, an inline prefix, a
 * chord. The editor's install pass feeds it each plugin's claims in list order; list order settles a
 * contested claim, as it does a conflict, and a chord the editor takes everywhere (search, undo,
 * redo) is never a plugin's.
 */
import { GLOBAL_KEYMAP, isReservedUiChord } from './commands';
import { chordDefect, normalizeChord } from './keybindings';
import { keepFirstListed, type PluginError } from './plugin-unit';

export interface PluginClaims {
	readonly colons?: readonly string[];
	readonly prefixes?: readonly string[];
	readonly chords?: readonly string[];
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
	['chords', 'the chord']
] as const;

interface Claim {
	label: (typeof CLAIMED)[number][1];
	raw: string;
	/** What two plugins' claims are compared by: a chord spelled the one way the keymap spells it. */
	key: string;
	defect: string | null;
}

function claimList(claims: PluginClaims): Claim[] {
	return CLAIMED.flatMap(([field, label]) =>
		(claims[field] ?? []).map((raw) => {
			const defect = field === 'chords' ? chordDefect(raw) : null;
			const key = field === 'chords' && defect === null ? normalizeChord(raw) : raw;
			return { label, raw, key, defect };
		})
	);
}

function problemWith({ label, raw, key, defect }: Claim): string | null {
	if (defect !== null) return `claims ${label} "${raw}", which isn't one: ${defect}`;
	if (label === 'the chord' && isReservedUiChord(key))
		return `claims ${label} "${raw}", which search takes`;
	if (label === 'the chord' && GLOBAL_KEYMAP.some((binding) => binding.chord === key))
		return `claims ${label} "${raw}", which undo or redo takes`;
	return null;
}

function sharedClaim(later: { list: Claim[] }, first: { list: Claim[] }): string | null {
	const shared = later.list.find((c) =>
		first.list.some((o) => o.label === c.label && o.key === c.key)
	);
	return shared ? `shares ${shared.label} "${shared.raw}" with` : null;
}
