/*
 * The one thing the app cannot do for itself: notice that it never started.
 *
 * Every file the app is made of is named after its contents, and a deploy
 * replaces those names. A phone holding an old copy of the page - an app on
 * the Home Screen, suspended for days - asks for files that are not there any
 * more, and the server answers with the page instead of the script. Nothing of
 * the app has run at that point, so nothing in it can catch the failure: the
 * screen is simply blank, and reloading the same address can hand back the
 * same old page. It did, on a phone, after the deploy of 23 October.
 *
 * So this runs first, as a plain script with no build step behind it, and
 * watches for the app's own scripts failing to load. When one does, it loads
 * the page again from an address no cache can be holding - the same `fresh`
 * tag staleBuild.ts's reloadFresh uses - once per session. If that does not
 * help either, it stops: a blank screen is bad, and one that reloads for ever
 * is worse. main.tsx clears the note when the app does start, so the next
 * deploy gets its own try.
 *
 * Kept tiny, and nothing in it is newer than what the app itself already
 * asks of a phone: it is never compiled, so it has to run as written.
 */
(function () {
  var NOTE = "church-directory:boot-retry";

  window.addEventListener(
    "error",
    function (event) {
      var element = event.target;
      if (!element || element.tagName !== "SCRIPT") return;
      if (!/\/assets\//.test(element.src || "")) return;

      try {
        if (sessionStorage.getItem(NOTE)) return;
        sessionStorage.setItem(NOTE, String(Date.now()));
      } catch (e) {
        // No storage, no way to know this is not the second time round.
        return;
      }

      var url = new URL(window.location.href);
      url.searchParams.set("fresh", Date.now().toString(36));
      window.location.replace(url.toString());
    },
    // Capture: a script that fails to load does not bubble its error.
    true,
  );
})();
