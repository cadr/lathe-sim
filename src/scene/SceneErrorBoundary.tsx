// Catches WebGL / Canvas failures so the rest of the app keeps working.
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface SceneErrorBoundaryProps {
  children: ReactNode;
  /** optional custom fallback */
  fallback?: ReactNode;
  /** silent: render null instead of the fallback (used around optional extras like the environment) */
  silent?: boolean;
  /** called after an error is caught */
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error);
    if (this.props.silent) return;
    console.error('3D view unavailable:', error.message, info.componentStack ?? '');
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return this.props.fallback ?? <SceneFallback />;
  }
}

/** Message shown in place of the 3D view. */
export interface SceneFallbackProps {
  /** headline (default "3D view unavailable.") */
  title?: string;
  /** explanation under the headline */
  message?: string;
}

const DEFAULT_MESSAGE =
  'Your browser could not start WebGL. Everything still works: use the section view and the DRO to follow the cut.';

export function SceneFallback({ title = '3D view unavailable.', message = DEFAULT_MESSAGE }: SceneFallbackProps) {
  return (
    <div data-testid="scene-fallback" role="status" style={fallbackStyle}>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

const fallbackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  width: '100%',
  height: '100%',
  minHeight: 200,
  padding: 24,
  boxSizing: 'border-box',
  color: '#c9cdd2',
  background: '#1b1e22',
};
