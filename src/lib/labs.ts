/**
 * Hooks for the labs feedback widget that labs.aaronjellis.com adds to the page. Elsewhere the
 * widget is absent and these do nothing.
 */

type LabsWindow = Window & { labsFeedback?: { milestone?: (name: string) => void } };

/** Report a finished export (a download, a print, a share) so the widget can suggest a sibling experiment once. */
export function reportExport(): void {
  (window as LabsWindow).labsFeedback?.milestone?.('export');
}
