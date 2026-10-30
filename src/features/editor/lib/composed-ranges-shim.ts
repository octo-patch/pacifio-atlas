/**
 * TEMPORARY: lets the file view's editor (`@pierre/diffs/edit`) see its caret
 * on the WebKit the desktop app runs on. Delete it with the editor's move back
 * to CodeMirror.
 *
 * The editor reads the caret on every `selectionchange` through
 * `getComposedRanges({ shadowRoots: [root] })`. The system WebKit (seen on
 * macOS 15.8) has `getComposedRanges` but only its older form, which takes the
 * shadow roots as arguments, and throws a TypeError on the dictionary. The
 * editor then never learns a selection: it draws no caret, and drops every
 * keystroke after cancelling the browser's own insertion. Chromium and newer
 * WebKit take the dictionary, so this changes nothing there.
 */

type ComposedRanges = (this: Selection, ...args: unknown[]) => StaticRange[];

function acceptsDictionary(getComposedRanges: ComposedRanges): boolean {
  const selection = document.getSelection();
  if (!selection) return true;
  try {
    getComposedRanges.call(selection, { shadowRoots: [] });
    return true;
  } catch {
    return false;
  }
}

if (typeof Selection !== "undefined") {
  const proto = Selection.prototype as unknown as { getComposedRanges?: ComposedRanges };
  const original = proto.getComposedRanges;
  if (original && !acceptsDictionary(original)) {
    proto.getComposedRanges = function (this: Selection, ...args: unknown[]) {
      const [first] = args;
      if (
        first !== null &&
        typeof first === "object" &&
        !(first instanceof ShadowRoot) &&
        Array.isArray((first as { shadowRoots?: unknown }).shadowRoots)
      ) {
        return original.call(this, ...(first as { shadowRoots: ShadowRoot[] }).shadowRoots);
      }
      return original.apply(this, args);
    };
  }
}

export {};
