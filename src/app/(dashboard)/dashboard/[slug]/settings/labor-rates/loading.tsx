export default function Loading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-40 rounded bg-gray-200 animate-pulse" />
        <div className="flex gap-2">
          <div className="h-10 w-48 rounded-lg bg-gray-200 animate-pulse" />
          <div className="h-10 w-28 rounded-lg bg-gray-200 animate-pulse" />
          <div className="h-10 w-44 rounded-lg bg-gray-200 animate-pulse" />
        </div>
      </div>
      <div className="mb-4 flex gap-3">
        <div className="h-10 flex-1 rounded-md bg-gray-200 animate-pulse" />
        <div className="h-10 w-36 rounded-md bg-gray-200 animate-pulse" />
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3 grid grid-cols-8 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-4 rounded bg-gray-200 animate-pulse" />)}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-6 py-4 grid grid-cols-8 gap-4 border-t border-gray-100">
            {Array.from({ length: 8 }).map((_, j) => <div key={j} className="h-5 rounded bg-gray-200 animate-pulse" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
