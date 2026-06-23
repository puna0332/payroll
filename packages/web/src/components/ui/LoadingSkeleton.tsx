interface LoadingSkeletonProps {
  rows?: number;
  type?: 'card' | 'table' | 'text' | 'kpi';
}

export function LoadingSkeleton({ rows = 4, type = 'table' }: LoadingSkeletonProps) {
  if (type === 'kpi') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 shadow-sm animate-pulse">
            <div className="h-3 bg-muted rounded w-20 mb-3" />
            <div className="h-6 bg-muted rounded w-24 mb-2" />
            <div className="h-3 bg-muted rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'card') {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-muted rounded w-32 mb-4" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-3 bg-muted rounded mb-3" style={{ width: `${85 - i * 10}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 bg-muted rounded animate-pulse" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}
