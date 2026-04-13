import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('products').select('name, pricing_type, price').eq('id', id).single()
  const product = data as { name: string; pricing_type: string | null; price: number | null } | null

  return (
    <div style={{padding: '2rem'}}>
      <p><Link href={`/dashboard/${slug}/products`}>&larr; Products</Link></p>
      <h1 style={{fontSize: '1.5rem', fontWeight: 'bold'}}>{product?.name ?? 'Product not found'}</h1>
      <p>Pricing Type: {product?.pricing_type ?? 'none'}</p>
      <p>Price: {product?.price ?? 0}</p>
    </div>
  )
}
