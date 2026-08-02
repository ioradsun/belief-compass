/**
 * PanelBoundary — keeps one panel's crash inside that panel.
 *
 * Before this, a render error anywhere in the center column bubbled to the
 * route's errorComponent and replaced the whole app with "Feed failed: …".
 * A broken create form should cost the user the create form, not the feed.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows what died. */
  label: string;
  /** Optional escape hatch, e.g. close the panel. */
  onDismiss?: () => void;
}

interface State {
  message: string | null;
}

export class PanelBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message.split("\n")[0] : "Something went wrong.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (this.state.message == null) return this.props.children;
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3 p-6 text-[13px]">
        <p className="font-medium text-[var(--text)]">{this.props.label} couldn&apos;t load.</p>
        <p className="text-[var(--text-muted)]">{this.state.message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ message: null })}
            className="rounded-full border px-3 py-1.5 text-[12px] text-[var(--text)]"
            style={{ borderColor: "var(--border)" }}
          >
            Try again
          </button>
          {this.props.onDismiss && (
            <button
              type="button"
              onClick={this.props.onDismiss}
              className="rounded-full px-3 py-1.5 text-[12px] text-[var(--text-muted)]"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }
}
