// A caret writer with no drawn caret to repaint, for a suite that writes the caret without a
// mounted editor's own writer.
import { createCaretWriter } from '#lib/caret/widget-offset.js';

export const testCaretWriter = createCaretWriter(() => {});
