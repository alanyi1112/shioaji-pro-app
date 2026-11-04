/** Keep the current layout route and choose the list independently in the new tab. */
export function openWatchlistWindow(
    listId: string,
    targetWindow: Pick<Window, 'open'> = window,
    appUrl = window.location.href,
) {
    const url = new URL(appUrl);
    url.searchParams.set('watchlist', listId);
    return targetWindow.open(url.toString(), '_blank', 'noopener');
}
