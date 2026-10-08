// Last-resort error boundary around the whole app: a render error in any panel shows a short
// message with a reload button instead of a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Lathe Sim crashed:', error, info.componentStack ?? '');
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" data-testid="app-error" style={boxStyle}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Something went wrong.</h1>
        <p style={{ margin: 0 }}>The simulator hit an error and stopped: {error.message}</p>
        <button type="button" style={buttonStyle} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

const boxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'flex-start',
  maxWidth: 560,
  margin: '15vh auto',
  padding: 24,
  color: '#e6e2d8',
  background: '#1f2328',
  border: '1px solid #3a3f46',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
};

const buttonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid #e0a040',
  background: '#e0a040',
  color: '#111',
  fontWeight: 600,
  cursor: 'pointer',
};
