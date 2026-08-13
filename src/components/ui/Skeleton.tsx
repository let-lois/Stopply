export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse rounded-2xl bg-white/6 ${className}`}
    />
  );
}
