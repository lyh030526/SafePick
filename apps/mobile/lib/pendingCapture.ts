import type { BrowserImport } from '../browserImport';

// A page read in the in-app browser, waiting for the analysis screen to pick it up when it comes back into view.
// Kept in memory only: it is the shopper's material and is sent nowhere until they agree on the analysis screen.
let pending: BrowserImport | null = null;

export function setPendingCapture(capture: BrowserImport) {
  pending = capture;
}

export function takePendingCapture(): BrowserImport | null {
  const capture = pending;
  pending = null;
  return capture;
}

// A link shared from another shopping app that the in-app browser does not open: the analysis screen fills it in.
let pendingLink = '';

export function setPendingLink(link: string) {
  pendingLink = link;
}

export function takePendingLink() {
  const link = pendingLink;
  pendingLink = '';
  return link;
}
