/**
 * Editor-layer re-export of the display/raw text primitives.
 *
 * The actual implementations live in `core/lines.ts` because the
 * raw-vs-display distinction is a parser-level concept. This file
 * exists as a stable editor-layer import path for the many call
 * sites that used to import from `raw-text` before the primitives
 * moved. Keeping the re-export avoids a sweeping import update and
 * preserves the editor-layer facade.
 */

export { displayLength, trimTrailingLineEnding } from './core/lines';
