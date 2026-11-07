import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: ErrorInfo | null;
  remountKey: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorInfo: null,
    remountKey: 0,
  };

  static getDerivedStateFromError(): Pick<ErrorBoundaryState, "hasError"> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary] panel crashed:", error, errorInfo.componentStack);
  }

  handleReload = (): void => {
    this.setState({
      hasError: false,
      errorInfo: null,
      remountKey: this.state.remountKey + 1,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex-1 h-full flex items-center justify-center">
          <section
            role="alert"
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-[var(--text-primary)]"
          >
            <p className="text-base font-medium">Something went wrong in this panel.</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
            >
              Reload
            </button>
          </section>
        </div>
      );
    }
    return (
      <div key={this.state.remountKey} className="flex min-h-0 min-w-0 flex-1">
        {this.props.children}
      </div>
    );
  }
}
