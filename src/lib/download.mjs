/** Download an already-processed browser-local file without importing PDF parsers. */
export function saveDownload(bytesOrBlob, filename, mime = 'application/pdf') {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mime });
  const url = URL.createObjectURL(blob);
  let anchor;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    // Some WebKit versions finish resolving a Blob download AFTER click()
    // returns. Removing the anchor synchronously can race that navigation.
    // Keep it attached, but hidden, for a short grace period. If click()
    // throws, the same cleanup still runs; the Blob URL remains valid long
    // enough for slower mobile downloads before it is revoked.
    setTimeout(() => anchor?.remove(), 1_000);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
