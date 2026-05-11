/**
 * v1.24.3 — CommentPanel ErrorBoundary.
 *
 * 한솔 보고: vendor-ui chunk 에서 댓글 렌더링 중 React 에러 발생 (단편적 stack 만 받음).
 * root cause 못 잡아도 *최소한 다른 기능을 막지 않게* fallback UI + 상세 에러 logging.
 * 다음 발생 시 console.error 로 명확한 component stack + props 가 찍힘 → 추가 진단 가능.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** 디버깅용 — 어느 댓글 패널이 죽었는지 식별 */
  panelId?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class CommentPanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 명확한 진단을 위해 *전체* 스택 + component stack 콘솔에 출력
    console.error('[CommentPanel ErrorBoundary] 댓글 렌더링 에러 캐치:', {
      panelId: this.props.panelId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 bg-bg-card">
          <AlertTriangle size={28} className="text-amber-400" />
          <div className="text-sm font-semibold text-text-primary">댓글 패널을 불러오지 못했습니다</div>
          <p className="text-[12px] text-text-secondary leading-relaxed max-w-[280px]">
            일시적인 오류로 댓글 영역만 멈췄습니다. 모달의 다른 기능은 그대로 사용 가능합니다.
            <br />
            <span className="text-text-secondary/60 text-[11px]">
              상세 정보는 콘솔 (Ctrl+Shift+I) 의 [CommentPanel ErrorBoundary] 로그를 확인해주세요.
            </span>
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded border border-accent/40 text-accent hover:bg-accent/10 cursor-pointer transition-colors"
          >
            <RefreshCw size={12} /> 다시 시도
          </button>
          {this.state.error && (
            <details className="mt-2 text-left max-w-[280px]">
              <summary className="text-[10.5px] text-text-secondary/60 cursor-pointer">
                기술 정보
              </summary>
              <code className="block mt-1 text-[10px] text-text-secondary/70 break-all whitespace-pre-wrap">
                {this.state.error.message}
              </code>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
