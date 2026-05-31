chrome.devtools.panels.elements.createSidebarPane('LocatorHub', function (sidebar) {
  sidebar.setPage('panel.html');

  // When the user clicks the LocatorHub tab, refresh for the currently
  // selected element (onSelectionChanged won't fire if they selected
  // the element while the sidebar was on a different tab).
  sidebar.onShown.addListener(function (win) {
    if (win && typeof win.locatorHubRefresh === 'function') {
      win.locatorHubRefresh();
    }
  });
});
