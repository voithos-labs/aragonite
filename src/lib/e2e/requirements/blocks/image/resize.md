# Feature: Image drag-to-resize and keyboard resize

## Happy paths

- Pointer drag on right handle resizes widget visually during drag
- Pointer-up commits |N into source (single undo entry)
- Shift+ArrowRight on selected widget keyboard-resizes wider
- Shift+ArrowLeft on selected widget keyboard-resizes narrower

## Edge cases

- Click-and-release on handle without movement is no-op (no undo entry)
- Drag near 25/50/75/100% snaps to those percentages
- Keyboard resize shares the drag path's envelope: Shift+ArrowRight caps at editor content width, Shift+ArrowLeft holds at the keyboard minimum (envelope math unit-covered in `image-resize.test.ts`)
- Broken image (load failed) shows the popover for URL editing but suppresses resize handles — handles re-appear if the URL is corrected and the image loads
