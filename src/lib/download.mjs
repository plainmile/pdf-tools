/** Download an already-processed browser-local file without importing PDF parsers. */
export function saveDownload(bytesOrBlob, filename, mime = 'application/pdf') {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mime });
  const url = URL.createObjectURL(blob);
  let anchor;
  let dispatched = false;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    dispatched = true;
  } finally {
    if (!dispatched) {
      // If the browser throws synchronously, no download handoff occurred.
      // Clean up immediately; do not leave a broken invisible link behind.
      anchor?.remove();
      URL.revokeObjectURL(url);
    } else {
      // A successful click can still be handed off asynchronously by
      // Firefox/WebKit. Retain the attached link for slower browser tasks;
      // the 60-second object URL lifetime is bounded as before.
      // This mitigates a possible race, not proof that the file reached disk.
      setTimeout(() => anchor?.remove(), 15_000);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}
