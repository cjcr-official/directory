import { Component, type ErrorInfo, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { isStaleBuildError, reloadForStaleBuild } from "@/lib/staleBuild";

/**
 * The last thing between a thrown error and a white screen.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * and what is left is a blank page: no message, no button, no indication that
 * anything was ever there. On a phone added to the Home Screen there is not
 * even an address bar to reload from. The people using this are two or three
 * volunteers in a church office, and "it went white" is not a thing they can
 * act on or report usefully.
 *
 * So the tree gets a floor. A crash becomes a screen that says the app hit a
 * problem, offers the reload that almost always fixes it, and - because a
 * crash on one screen is not a reason to lose the other thirteen - a way back
 * to the directory that resets the boundary rather than reloading.
 *
 * A class, because after nine years it is still the only way: there is no hook
 * for this, and React 19 did not add one. getDerivedStateFromError and
 * componentDidCatch are lifecycle methods and have no equivalent.
 */

interface Props {
  children: ReactNode;
  /**
   * Changes when the person navigates. A boundary that has caught something
   * keeps showing its screen until something tells it the situation has moved
   * on, and going somewhere else is that: the render that threw is not the
   * render being asked for now.
   */
  resetKey?: string;
  /** Offered where there is somewhere sensible to go back to. */
  onGoHome?: () => void;
}

interface State {
  error: Error | null;
  /** True while a reload for a replaced chunk is under way. */
  reloading: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  /**
   * Which of the two screens this is, decided in the same render that catches.
   *
   * Deciding it here rather than in componentDidCatch is what stops a file the
   * deploy replaced flashing "Something went wrong" for a frame on its way to
   * the screen that says it is updating - React renders the state this returns
   * before it calls componentDidCatch, so anything settled there is one frame
   * late. Reading the message is a pure question about the error, which is all
   * this method is allowed to be; the reload it implies is a side effect and
   * waits below.
   */
  static getDerivedStateFromError(error: unknown): State {
    const thrown = error instanceof Error ? error : new Error(String(error));
    return { error: thrown, reloading: isStaleBuildError(thrown) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // A file that is no longer on the server is an old build, not a fault, and
    // the fix is mechanical.
    if (isStaleBuildError(error)) {
      if (reloadForStaleBuild()) return;
      // Already tried, and it did not help. Stop promising a reload and say
      // what is actually the matter. Not logged: this is a deploy that moved
      // underneath a browser, which is nobody's bug.
      this.setState({ reloading: false });
      return;
    }

    // There is no error reporting service wired up, and adding one would mean
    // sending a congregation's screens to a third party. The console is what
    // there is: it survives in devtools on a desktop, which is where anybody
    // investigating this will be, and the component stack is the part that says
    // which screen it was.
    console.error("[church-directory] a screen failed to render", error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reloading: false });
    }
  }

  private readonly reload = () => {
    window.location.reload();
  };

  private readonly goHome = () => {
    this.setState({ error: null, reloading: false });
    this.props.onGoHome?.();
  };

  render(): ReactNode {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="update-screen" role="status" aria-live="polite">
          <div className="update-screen-inner">
            <Logo className="update-screen-logo" />
            <span className="spinner on-dark" aria-hidden />
            <p className="update-screen-title">Updating the directory</p>
            <p className="update-screen-sub">Fetching the newest version.</p>
          </div>
        </div>
      );
    }

    // Said as a fact about the app rather than about the person, and without
    // the error's own text, which is written for whoever wrote the code. The
    // message is kept in the console for them instead.
    const stale = isStaleBuildError(error);

    return (
      <div className="update-screen" role="alert">
        <div className="update-screen-inner">
          <Logo className="update-screen-logo" />
          <p className="update-screen-title">
            {stale ? "This copy is out of date" : "Something went wrong"}
          </p>
          <p className="update-screen-sub">
            {stale
              ? "Part of the app could not be fetched, and reloading has already been tried once. Check the connection, then try again."
              : "This screen could not be drawn. Nothing you had already saved is affected."}
          </p>
          <span className="row tight crash-actions">
            <button type="button" className="btn primary small" onClick={this.reload}>
              Reload
            </button>
            {this.props.onGoHome ? (
              <button type="button" className="btn ghost small" onClick={this.goHome}>
                Back to the directory
              </button>
            ) : null}
          </span>
        </div>
      </div>
    );
  }
}
