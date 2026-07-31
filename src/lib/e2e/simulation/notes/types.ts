import type { Gestures } from '../gestures';

/**
 * An authoring script plus the canonical source it must serialize to. `build` carries CLEAN
 * intent — typos and detours come from the Gestures layer, never the fixture.
 * `expectedMarkdown` is calibrated against the editor (typing ≡ loading), never hand-guessed.
 * `landmarks` are in-order phrases, so a reorder or drop surfaces in structural-only regions
 * end-state equality cannot reach.
 */
export interface NoteFixture {
	name: string;
	build(g: Gestures): Promise<void>;
	expectedMarkdown: string;
	landmarks: readonly string[];
}
