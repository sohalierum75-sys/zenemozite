import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#0f1115] text-white">
          <div className="max-w-md w-full glass-card rounded-3xl p-6 sm:p-8 text-center border border-white/10 shadow-2xl space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <h2 className="text-xl font-bold text-white">Something went wrong</h2>
            <p className="text-xs text-[#8b94a6] leading-relaxed">
              We encountered an unexpected interface error. Your session and movie database remain completely safe.
            </p>

            {this.state.error?.message && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-left font-mono text-[11px] text-rose-300 break-all max-h-32 overflow-y-auto">
                {this.state.error.message}
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-[var(--accent)] text-[#0f1115] font-bold text-xs flex items-center justify-center space-x-2 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg shadow-[var(--accent)]/20"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Page</span>
              </button>

              <a
                href="/"
                className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer border border-white/10"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
