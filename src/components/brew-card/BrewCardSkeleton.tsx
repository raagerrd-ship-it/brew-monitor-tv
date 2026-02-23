import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shimmer skeleton placeholder matching BrewCard layout.
 * Shown while brew data is loading.
 */
export function BrewCardSkeleton() {
  return (
    <div
      className="rounded-xl border border-white/15 flex flex-col overflow-hidden h-full"
      style={{
        background: 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      {/* Header skeleton */}
      <div className="px-3 py-2 flex-shrink-0" style={{ height: '80px' }}>
        <div className="flex items-center gap-2 h-full">
          <Skeleton className="w-[52px] h-[52px] rounded-lg flex-shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>

      {/* Chart area skeleton */}
      <div className="flex-1 min-h-0 p-2 pb-1">
        <Skeleton className="w-full h-full rounded-lg" />
      </div>

      {/* Stats grid skeleton */}
      <div className="px-3 py-1.5 flex-shrink-0" style={{ height: '148px' }}>
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5 h-full">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
