import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''
  if (query.length < 3) return NextResponse.json(null)

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return NextResponse.json(null)

  try {
    // Text Search — find the business
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`,
      { cache: 'no-store' }
    )
    const searchData = await searchRes.json()
    const placeId: string | undefined = searchData.results?.[0]?.place_id
    if (!placeId) return NextResponse.json(null)

    // Place Details — get structured address
    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=address_components,formatted_address&key=${key}`,
      { cache: 'no-store' }
    )
    const detailData = await detailRes.json()
    const components: { types: string[]; long_name: string; short_name: string }[] =
      detailData.result?.address_components ?? []

    function get(type: string, short = false): string {
      const comp = components.find((c) => c.types.includes(type))
      return comp ? (short ? comp.short_name : comp.long_name) : ''
    }

    return NextResponse.json({
      street: [get('street_number'), get('route')].filter(Boolean).join(' '),
      city: get('locality') || get('sublocality_level_1') || get('administrative_area_level_2'),
      state: get('administrative_area_level_1', true),
      zip: get('postal_code'),
      country: get('country', true) || 'US',
      formatted_address: detailData.result?.formatted_address ?? '',
    })
  } catch {
    return NextResponse.json(null)
  }
}
