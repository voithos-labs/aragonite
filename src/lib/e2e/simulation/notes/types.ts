import type { Gestures } from '../gestures';

/**
 * A script for writing a note, plus the source it must serialize to. `build` types the note
 * cleanly: typos and detours come from the gestures, never from the fixture.
 * `expectedMarkdown` is taken from the editor, by loading the same markdown, never guessed by
 * hand. `landmarks` are phrases in order, so a block moved or dropped shows up in the parts of
 * the document the end-state check cannot see.
 */
export interface NoteFixture {
	name: string;
	build(g: Gestures): Promise<void>;
	expectedMarkdown: string;
	landmarks: readonly string[];
}
