export default function Loading() {
  return (
    <div className="p-8">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <div className="h-4 w-16 rounded bg-gray-200 animate-pulse" />
          <span>/</span>
          <div className="h-4 w-20 rounded bg-gray-200 animate-pulse" />
          <span>/</span>
          <div className="h-4 w-20 rounded bg-gray-200 animate-pulse" />
        </div>
        <div className="flex items-center justify-between">
          <div className="h-8 w-40 rounded bg-gray-200 animate-pulse" />
          <div className="h-10 w-44 rounded-lg bg-gray-200 animate-pulse" />
        </div>
      </div>

      {/* Filters skeleton */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="h-10 flex-1 min-w-[240px] rounded-md bg-gray-200 animate-pulse" />
        <div className="h-10 w-36 rounded-md bg-gray-200 animate-pulse" />
        <div className="h-10 w-44 rounded-md bg-gray-200 animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
          <div className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-gray-200 animate-pulse" />
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-6 py-4">
              <div className="grid grid-cols-6 gap-4 items-center">
                <div className="h-5 rounded bg-gray-200 animate-pulse" />
                <div className="h-4 rounded bg-gray-200 animate-pulse" />
                <div className="h-4 rounded bg-gray-200 animate-pulse" />
                <div className="h-4 rounded bg-gray-200 animate-pulse" />
                <div className="h-6 w-20 rounded-full bg-gray-200 animate-pulse" />
                <div className="h-4 w-12 rounded bg-gray-200 animate-pulse ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
