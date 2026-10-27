import React, { useEffect, useRef, useState } from 'react';

const COPY = {
  en: {
    title: 'Leave without saving your work?',
    message: 'This PDF or text is only in this browser tab. Leaving now loses any edits or results you have not downloaded. Export your work first, or keep editing.',
    recoverableDeletedMessage: 'All pages have been deleted, but you can still Undo to restore them. Leaving now permanently loses that Undo history and the documents held only in this browser tab. Keep editing to restore the pages, or explicitly clear the workspace.',
    processingMessage: 'A file is still loading or being processed in this browser tab. Leaving now interrupts that operation and discards any unfinished result. Keep editing to finish, or cancel the operation first.',
    stay: 'Keep editing',
    leave: 'Leave without saving',
  },
  zh: {
    title: '确定离开并放弃未保存的内容？',
    message: '文件和编辑结果仅保存在当前浏览器标签页。离开后，尚未下载的修改或结果会丢失。您可以先导出，或者继续编辑。',
    recoverableDeletedMessage: '所有页面已删除，但仍可通过“撤销”恢复。现在离开会永久丢失撤销历史及当前标签页保存的文档。请先继续编辑并撤销，或明确清空整个工作台。',
    processingMessage: '当前标签页仍在读取或处理文件。现在离开会中断本次操作，尚未完成的结果不会保存。请继续处理至完成，或者先取消操作。',
    stay: '继续编辑',
    leave: '放弃并离开',
  },
};

/**
 * Protect only unsaved in-memory documents. Never persist file contents.
 *
 * Same-tab anchor navigation gets an accessible in-page confirmation. Browser
 * Back/Reload/Close receives the native beforeunload confirmation (subject to
 * each browser's user-interaction and dialog restrictions). Downloads, new-tab
 * links, Ctrl/Cmd-click and same-document fragment navigation are untouched.
 */
export default function UnsavedNavigationGuard({ active = false, locale = 'en', recoverableDeletedPages = false, processing = false }) {
  const [pendingHref, setPendingHref] = useState(null);
  const allowLeave = useRef(false);
  const previousLink = useRef(null);
  const stayButton = useRef(null);
  const leaveButton = useRef(null);
  const t = COPY[locale] || COPY.en;

  useEffect(() => {
    if (!active) {
      setPendingHref(null);
      return undefined;
    }

    const beforeUnload = (event) => {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const intercept = (event) => {
      if (allowLeave.current || event.defaultPrevented || event.button !== 0 ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute('download') ||
          (anchor.target && anchor.target !== '_self')) return;
      const href = anchor.href;
      if (!/^https?:\/\//i.test(href)) return;
      const destination = new URL(href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin === current.origin &&
          destination.pathname === current.pathname &&
          destination.search === current.search) return;
      event.preventDefault();
      event.stopPropagation();
      previousLink.current = anchor;
      setPendingHref(destination.href);
    };

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', intercept, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', intercept, true);
    };
  }, [active]);

  useEffect(() => {
    if (pendingHref) stayButton.current?.focus();
  }, [pendingHref]);

  const stay = () => {
    setPendingHref(null);
    previousLink.current?.focus();
  };

  const leave = () => {
    if (!pendingHref) return;
    allowLeave.current = true;
    const href = pendingHref;
    setPendingHref(null);
    window.location.assign(href);
  };

  if (!pendingHref || !active) return null;
  return (
    <div className="unsaved-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="unsaved-title"
        aria-describedby="unsaved-message" className="unsaved-dialog"
        data-testid="unsaved-navigation-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); stay(); }
          if (event.key === 'Tab') {
            if (event.shiftKey && document.activeElement === stayButton.current) {
              event.preventDefault(); leaveButton.current?.focus();
            } else if (!event.shiftKey && document.activeElement === leaveButton.current) {
              event.preventDefault(); stayButton.current?.focus();
            }
          }
        }}>
        <h2 id="unsaved-title">{t.title}</h2>
        <p id="unsaved-message">{recoverableDeletedPages ? t.recoverableDeletedMessage : processing ? t.processingMessage : t.message}</p>
        <div className="unsaved-actions">
          <button ref={stayButton} type="button" className="button button-primary"
            data-testid="unsaved-keep" onClick={stay}>{t.stay}</button>
          <button ref={leaveButton} type="button" className="button button-secondary muted-danger"
            data-testid="unsaved-leave" onClick={leave}>{t.leave}</button>
        </div>
      </div>
    </div>
  );
}
