import React from 'react';

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ComfySilly render failure', error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main className="min-h-screen bg-slate-950 p-12 text-slate-200">
          <h1 className="text-xl font-semibold">界面发生错误，而不是没有内容</h1>
          <p className="mt-4 text-sm text-slate-400">
            不会自动删除角色卡或历史记录。请保留下面的错误信息；重新加载会丢失尚未保存的修改。
          </p>
          <pre className="my-6 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-4 text-sm text-rose-300">
            {String(this.state.error)}
          </pre>
          <button className="rounded-lg bg-violet-600 px-4 py-2" onClick={() => location.reload()}>
            重新加载界面
          </button>
        </main>
      );
    return this.props.children;
  }
}
