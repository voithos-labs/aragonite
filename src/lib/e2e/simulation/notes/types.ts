import type { Gestures } from '../gestures';

/**
 * An authoring script plus the canonical source it must serialize to. `build`
 * carries clean intent — typos and detours come from the Gestures layer and the
 * orchestrator, never the fixture. It may mark structural-unit boundaries with
 * `g.checkpoint(...)`, which mutates nothing and only fires when the capture run
 * wires a recorder hook. `expectedMarkdown` is calibrated against the editor
 * (typing ≡ loading), not hand-guessed. `landmarks` are in-order phrases the
 * simulator checks with assertContainsInOrder, so a reorder or drop in any
 * structural-only region surfaces even when end-state equality can't reach it.
 */
export interface NoteFixture {
	name: string;
	build(g: Gestures): Promise<void>;
	expectedMarkdown: string;
	landmarks: readonly string[];
	/**
	 * Set only when the note's built tree is byte-faithful but STRUCTURALLY
	 * divergent from a reparse of its own serialization — exempting it from the
	 * checkpoint convergence oracle with a visible reason (never a silent skip).
	 * The one live class today: a note that types content after an UNCLOSED fenced
	 * code block. The trailing blocks are separate live nodes but GFM lazy-collapses
	 * them into the fence on reload (see docs/issues.md). `expectedMarkdown` +
	 * round-trip still guard the bytes; only structural convergence is waived.
	 */
	unconvergedReason?: string;
}
