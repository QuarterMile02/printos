'use client'

import { useEffect, useRef } from 'react'

export type AddressResult = {
  street: string
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
        const place = ac.getPlace()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const get = (type: string, short = false): string => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comp = (place.address_components ?? []).find((c: any) => c.types.includes(type))
          return comp ? (short ? comp.short_name : comp.long_name) : ''
        }
        const result: AddressResult = {
          street: [get('street_number'), get('route')].filter(Boolean).join(' '),
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
