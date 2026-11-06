/**
 * What the plugins on one editor claim that two can't share: a `:::` name, an inline prefix, a
 * chord. The editor's install pass feeds it each plugin's claims in list order; the first claimant
 * keeps a contested claim, and a chord the editor's own search takes is never a plugin's.
 */
import { isReservedUiChord } from './commands';
import { normalizeChordStrict } from './keybindings';
import type { PluginError } from './plugin-unit';

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
	const owners = new Map<string, string>();
	const refused = new Set<string>();
	for (const { plugin, claims } of claimants) {
		const list = claimList(claims);
		const problem = list.map((claim) => problemWith(claim, owners)).find((p) => p !== null);
		if (problem === undefined) {
			for (const claim of list) owners.set(`${claim.label}:${claim.key}`, plugin);
			continue;
		}
		refused.add(plugin);
		report({ plugin, doing: 'install', cause: new Error(`plugin '${plugin}' ${problem}`) });
	}
	return refused;
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
	key: string | null;
}

function claimList(claims: PluginClaims): Claim[] {
	return CLAIMED.flatMap(([field, label]) =>
		(claims[field] ?? []).map((raw) => ({
			label,
			raw,
			key: field === 'chords' ? normalizeChordStrict(raw) : raw
		}))
	);
}

function problemWith(claim: Claim, owners: Map<string, string>): string | null {
	const { label, raw, key } = claim;
	if (key === null) return `claims ${label} "${raw}", which isn't one`;
	if (label === 'the chord' && isReservedUiChord(key))
		return `claims ${label} "${raw}", which search takes`;
	const owner = owners.get(`${label}:${key}`);
	return owner === undefined ? null : `claims ${label} "${raw}", which '${owner}' already has`;
}
