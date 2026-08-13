import '@testing-library/jest-dom/vitest';

// jsdom implements the <dialog> element's `open` property but not showModal()
// or close(). The component under test uses the native element deliberately,
// because it is the platform's own answer to focus containment, Escape, the
// inert background, and focus restore, and hand-rolling those is how they get
// subtly wrong.
//
// This shim supplies only the plumbing those tests need: the open/closed
// transition, and Escape firing `cancel` the way a browser does. What it
// cannot stand in for is behaviour the browser owns, so be clear about the
// split:
//
//   covered here    the cancel handler, backdrop-click dismissal, body scroll
//                   lock, and remount-on-open
//   covered by the browser, checked in manual QA
//                   focus moving into the dialog, focus being trapped, focus
//                   returning to the trigger, the background going inert
//
// A shim that pretended to cover the second group would be worse than none.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  const openDialogs = new WeakMap<HTMLDialogElement, (event: KeyboardEvent) => void>();

  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The browser fires `cancel` first, and only closes itself if nothing
      // prevented it. The component prevents it and drives state instead.
      const proceeded = this.dispatchEvent(new Event('cancel', { cancelable: true }));
      if (proceeded) this.close();
    };
    document.addEventListener('keydown', onKeyDown);
    openDialogs.set(this, onKeyDown);
  };

  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    const onKeyDown = openDialogs.get(this);
    if (onKeyDown) {
      document.removeEventListener('keydown', onKeyDown);
      openDialogs.delete(this);
    }
    this.dispatchEvent(new Event('close'));
  };
}
