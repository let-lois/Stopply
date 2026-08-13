import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';

// The prototype had none, so a throw anywhere in a module view produced a
// blank page with no way back.
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
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
              className="rounded-xl bg-[var(--color-accent-indigo)] px-4 py-2 text-sm font-medium text-white"
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
