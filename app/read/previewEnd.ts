interface PreviewPosition {
  isGuest: boolean;
  currentPage: number;
  totalPages: number;
}

/**
 * A guest receives only the preview pages (see truncateToPreviewPages), so the
 * reader's last page is the end of what they may read. An empty preview has no
 * pages at all, and there too the guest has nothing more to read.
 */
export function showsPreviewEnd({ isGuest, currentPage, totalPages }: PreviewPosition): boolean {
  return isGuest && currentPage >= totalPages;
}
