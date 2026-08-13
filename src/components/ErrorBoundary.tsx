import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';

// The prototype had none, so a throw anywhere in a module view produced a
// blank page with no way back.
interface State {
  error: Error | null;
  resetKey: string | undefined;
}

interface Props {
  children: ReactNode;
  /**
   * Change this to clear a caught error. The shell mounts one boundary above
   * the outlet, so without it a view that threw keeps its failure on screen
   * after you have navigated somewhere else entirely, and the whole platform
   * reads as broken. Reset on props rather than in an effect: the fallback
   * must never be rendered for the new location, not even for one frame.
   */
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Phase 2 sends this somewhere. For now the console is the only sink, and
    // saying so is better than pretending it is reported.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title="This section could not be displayed"
          body="Something went wrong rendering this view. Reloading usually clears it; if it keeps happening, the details are in the browser console."
          action={
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)]"
            >
              Try again
            </button>
          }
        />
      );
    }
    return this.props.children;
  }
}
