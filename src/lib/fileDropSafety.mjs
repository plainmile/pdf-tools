/** Keep a local-only editing session from disappearing when a desktop file is
 * dropped on a header, footer, or another area without its own upload handler.
 * Browsers can otherwise navigate directly to the dropped PDF/image.
 *
 * Do not handle the file here: the tool's existing dropzone validates and
 * imports it. Do not intercept dragged text/links or page-thumbnail reorders.
 */
export function protectLocalFileDropNavigation(target) {
  const preventFileNavigation = (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
      event.preventDefault();
    }
  };
  target.addEventListener('dragover', preventFileNavigation);
  target.addEventListener('drop', preventFileNavigation);
  return () => {
    target.removeEventListener('dragover', preventFileNavigation);
    target.removeEventListener('drop', preventFileNavigation);
  };
}
