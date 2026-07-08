/*
 * BPWS public site runtime.
 * The board address is assembled here at load time rather than hard-coded in
 * the HTML, so serving proxies and scrapers don't see it in the source.
 *   [data-board-email]  -> textContent set to the address
 *   [data-board-mailto] -> href set to mailto:<address>
 * No-JS fallback: elements read "the board" and are non-clickable.
 */
(function () {
  var addr = ['board', 'beulahparkws.org'].join('@');
  var t = document.querySelectorAll('[data-board-email]');
  for (var i = 0; i < t.length; i++) t[i].textContent = addr;
  var m = document.querySelectorAll('[data-board-mailto]');
  for (var j = 0; j < m.length; j++) m[j].setAttribute('href', 'mailto:' + addr);
})();
