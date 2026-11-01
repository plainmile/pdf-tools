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
    // The browser may resolve a blob: download asynchronously after click()
    // returns. Firefox/WebKit can otherwise silently miss a generated-file
    // download while its preview and button remain visible. Keep the hidden
    // anchor attached for longer on slow or busy devices; still revoke the
    // object URL promptly enough to avoid leaking large PDF/ZIP blobs.
    // This is a race mitigation, not confirmation that a download reached disk.
    setTimeout(() => anchor?.remove(), 15_000);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
