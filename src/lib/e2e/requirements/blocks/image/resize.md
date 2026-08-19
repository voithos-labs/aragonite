# Feature: Image drag-to-resize and keyboard resize

## Happy paths

- Pointer drag on right handle resizes widget visually during drag
- Pointer-up commits |N into source (single undo entry)
- Back-to-back drags on the same handle both commit: the handle resolves the widget element on demand, so the second drag measures a live node rather than the one the first commit detached
- The right handle sits at the image's right edge, not the editor's: its center tracks the image box within a few pixels
- Shift+ArrowRight on selected widget keyboard-resizes wider
- Shift+ArrowLeft on selected widget keyboard-resizes narrower

## Edge cases

- Click-and-release on handle without movement is no-op (no undo entry)
- Drag near 25/50/75/100% snaps to those percentages (snap math unit-covered in `image-resize.test.ts`)
- Keyboard resize shares the drag path's envelope: Shift+ArrowRight caps at editor content width, Shift+ArrowLeft holds at the keyboard minimum (envelope math unit-covered in `image-resize.test.ts`)
- Broken image (load failed) shows the popover for URL editing but suppresses resize handles — handles re-appear if the URL is corrected and the image loads

## Miss-analysis

- Back-to-back drags: every drag scenario committed exactly one drag, so nothing ever re-measured a handle after a commit rebuilt the inline DOM. The class is a gesture whose SECOND invocation crosses a re-render — the repeat press is the pin, not the first one.
- Handle position: the handle scenarios drove whatever handle they found and asserted committed bytes only, never geometry, so a full-editor-width widget span could park the handle at the editor edge with every byte assertion still green.
