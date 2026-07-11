import DepartmentBoard from './DepartmentBoard'
import ManagementBoard from './ManagementBoard'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ dept?: string; view?: string }>
}

export default async function DisplayPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { dept, view } = await searchParams

  return (
    <div className="bg-[#1A1A1A] min-h-screen">
      {dept && view !== 'management' ? (
        <DepartmentBoard slug={slug} dept={dept} />
      ) : (
        <ManagementBoard slug={slug} />
      )}
    </div>
  )
}
