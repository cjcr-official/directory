/**
 * Page zoom is off everywhere in the app. The screens are laid out for the
 * width of the device, and a stray two-finger drag while scrolling a list used
 * to leave the whole app scaled and shunted sideways, with nothing on screen
 * to say what had happened or how to undo it.
 *
 * The viewport tag in index.html settles it on Android and on desktop
 * browsers. iOS Safari has ignored user-scalable since iOS 10, so the gesture
 * handlers below are what actually stop a pinch there; the wheel handler is
 * the same gesture arriving from a trackpad.
 *
 * One-finger scrolling is untouched: only gestures that would scale the page
 * are cancelled.
 */
export function lockZoom(): void {
  // Safari's own pinch events. Cancelling gesturestart is enough to stop the
  // zoom; the other two cover a gesture already under way when this runs.
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, cancel, { passive: false });
  }

  // Everywhere else a pinch arrives as a touchmove with more than one finger
  // down. A single finger is an ordinary scroll and has to keep working.
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) cancel(event);
    },
    { passive: false },
  );

  // A trackpad pinch, and ctrl+scroll on a mouse, both arrive as a wheel event
  // with ctrlKey set. A plain scroll never has it.
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) cancel(event);
    },
    { passive: false },
  );
}

function cancel(event: Event): void {
  // Listeners registered as non-passive above, so this is always honoured.
  event.preventDefault();
}
