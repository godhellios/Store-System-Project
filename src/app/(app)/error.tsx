"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-lg font-semibold text-slate-800">Something went wrong</h2>
      <p className="text-sm text-slate-500 max-w-sm">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      {error.stack && (
        <pre className="text-left text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 max-w-xl w-full overflow-auto max-h-48 whitespace-pre-wrap">
          {error.stack}
        </pre>
      )}
      {error.digest && (
        <p className="text-xs text-slate-400">digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
