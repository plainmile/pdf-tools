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
    // A restrictive browser may throw during the synthetic click. Even on
    // failure, remove the hidden anchor and release the temporary Blob URL.
    anchor?.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
