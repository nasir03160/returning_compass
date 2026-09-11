import React, { Suspense } from 'react';

interface State {
  failed: boolean;
}

/**
 * Catches a failed/missing GLB load (useGLTF throws inside Suspense on a 404
 * or a bad file) so it degrades to `fallback` instead of unmounting the whole
 * React tree — which is what "the game won't even run" turns out to be: one
 * optional asset going missing took the entire scene down with it.
 *
 * Wrap every top-level GLB consumer in <SafeAsset> instead of a bare
 * <Suspense>. Combines the error boundary with the Suspense boundary so
 * callers don't need both.
 */
class AssetErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn('[SafeAsset] a GLB failed to load — using its fallback.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function SafeAsset({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <AssetErrorBoundary fallback={fallback}>
      <Suspense fallback={null}>{children}</Suspense>
    </AssetErrorBoundary>
  );
}
