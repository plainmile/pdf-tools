import { checkCancelled } from './utilityCore.mjs';

/** FileReader can abort an in-progress read. File.arrayBuffer() cannot. */
export function readFileArrayBuffer(file, signal = null) {
  checkCancelled(signal);
  if (!signal) return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      finish(null, new Error('Processing cancelled.'));
    };
    reader.onload = () => finish(reader.result, signal.aborted ? new Error('Processing cancelled.') : null);
    reader.onerror = () => finish(null, reader.error || new Error('Unable to read input file.'));
    reader.onabort = () => finish(null, new Error('Processing cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { reader.readAsArrayBuffer(file); }
    catch (error) { finish(null, error); }
  });
}

/** Release the UI on Cancel even if a third-party PDF worker does not settle
 * its promise promptly. The caller also destroys the underlying loading task.
 */
export function abortableWait(promise, signal = null) {
  checkCancelled(signal);
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(new Error('Processing cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); if (signal.aborted) reject(new Error('Processing cancelled.')); else resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}

