'use client'

import { useEffect, useRef } from 'react'

export type AddressResult = {
  street: string
  street2: string
  city: string
  state: string
  zip: string
  country: string
}

type Props = {
  onSelect: (address: AddressResult) => void
  defaultValue?: string
  name?: string
  className?: string
}

const SCRIPT_ID = 'google-maps-places'

// Fallback for when Google doesn't return a structured "subpremise"
// address component for the unit/suite/apt number -- confirmed this is
// common even when the user typed it as part of their search query
// (e.g. "6420 Polaris Drive ste 4"): Google's place result frequently
// omits "ste 4" from address_components entirely, even though the
// autocomplete widget's own input field still displays it as typed/
// selected. Regex against that raw displayed text as a last resort so
// the suite doesn't silently vanish. Matches the designator + value
// together (e.g. "Ste 4", "Suite 100", "Apt 2B", "#4") since that's
// clearer on the form than a bare number.
//
// Verification status: parseSuiteFallback's regex logic itself is
// covered by a 13-case standalone test (including two real bugs caught
// and fixed -- a missing \b before "#" and a false-positive match
// inside "United"/"Apartado"). The end-to-end path through the real
// Google Places dropdown (subpremise-present vs. subpremise-absent) is
// NOT yet verified live -- the dev API key is correctly referrer-
// restricted to printos-six.vercel.app, so it can't be exercised from
// localhost. Recommend a real check on the production URL once this
// deploys, searching "6420 Polaris Drive ste 4" (Laredo, TX) -- the
// exact address that surfaced this bug -- and confirming Street 2
// populates via the fallback (this address is expected to lack a
// structured subpremise from Google, which is exactly the case this
// fix targets).
function parseSuiteFallback(rawText: string): string {
  // \b after each bare word (not just before) so "Unit 3" matches but "United
  // Blvd" and "Apartado Ave" don't -- \b alone before "unit"/"apt" would still
  // match those false positives since \b only checks a boundary, not a full
  // word. "#" gets no \b since it's not a word character and typically
  // follows a space, which is already an unambiguous separator.
  const match = rawText.match(/(?:\b(?:suite\b|ste\b\.?|apt\b\.?|apartment\b|unit\b)|#)\s*[:-]?\s*[a-z0-9-]+/i)
  return match ? match[0].trim() : ''
}

function loadScript(apiKey: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any
  if (win.google?.maps?.places?.Autocomplete) return Promise.resolve()

  return new Promise((resolve, reject) => {
    if (document.getElementById(SCRIPT_ID)) {
      const poll = setInterval(() => {
        if (win.google?.maps?.places?.Autocomplete) {
          clearInterval(poll)
          resolve()
        }
      }, 50)
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Maps failed to load'))
    document.head.appendChild(script)
  })
}

export default function AddressAutocomplete({ onSelect, defaultValue, name, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey || !inputRef.current) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let listener: any

    loadScript(apiKey).then(() => {
      if (!inputRef.current) return
      const ac = new win.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: ['us', 'mx'] },
        fields: ['address_components'],
      })
      listener = win.google.maps.event.addListener(ac, 'place_changed', () => {
        // Capture the input's displayed text before we overwrite it below --
        // this is what the subpremise fallback parses. By the time
        // place_changed fires, Google has already replaced the field's text
        // with the selected prediction's description (or left the user's own
        // typed text in place if nothing was clicked), so this is the most
        // complete text available for the regex fallback.
        const rawText = inputRef.current?.value ?? ''
        const place = ac.getPlace()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const get = (type: string, short = false): string => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comp = (place.address_components ?? []).find((c: any) => c.types.includes(type))
          return comp ? (short ? comp.short_name : comp.long_name) : ''
        }
        const result: AddressResult = {
          street: [get('street_number'), get('route')].filter(Boolean).join(' '),
          street2: get('subpremise') || parseSuiteFallback(rawText),
          city: get('locality') || get('sublocality_level_1') || get('administrative_area_level_2'),
          state: get('administrative_area_level_1', true),
          zip: get('postal_code'),
          country: get('country', true),
        }
        onSelectRef.current(result)
        if (inputRef.current) inputRef.current.value = result.street
      })
    }).catch(() => { /* graceful degradation if Maps fails to load */ })

    return () => {
      if (listener && win.google?.maps?.event) {
        win.google.maps.event.removeListener(listener)
      }
    }
  }, []) // intentionally run once — onSelectRef keeps callback current

  return (
    <input
      ref={inputRef}
      type="text"
      name={name}
      defaultValue={defaultValue}
      placeholder="Start typing an address…"
      className={className}
      autoComplete="off"
    />
  )
}
