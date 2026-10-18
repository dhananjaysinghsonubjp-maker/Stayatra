import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button, inputClass } from '../components/ui';

export interface PropertyAddress {
  addressLine: string;
  apartmentOrFloor: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

const DEFAULT_CENTER: [number, number] = [22.9734, 78.6569]; // India, roughly centered
const DEFAULT_ZOOM = 5;

// A plain colored pin as a DivIcon — Leaflet's default marker image paths don't resolve correctly
// through Vite's bundler without extra config, and a DivIcon sidesteps that entirely.
const PIN_ICON = L.divIcon({
  className: '',
  html: `<svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 11 16 26 16 26s16-15 16-26C32 7.163 24.837 0 16 0z" fill="#4f46e5"/>
    <circle cx="16" cy="16" r="6" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
});

async function nominatimSearch(q: string): Promise<NominatimResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  return res.json();
}

async function nominatimReverse(lat: number, lon: number): Promise<NominatimResult | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

function fieldsFromResult(r: NominatimResult): Pick<PropertyAddress, 'addressLine' | 'city' | 'state' | 'pincode'> {
  const a = r.address ?? {};
  const city = a.city || a.town || a.village || a.suburb || a.county || '';
  return {
    addressLine: r.display_name,
    city,
    state: a.state ?? '',
    pincode: a.postcode ?? '',
  };
}

/**
 * "Where is your property?" — the first step of List Your Property. Real geocoding, not a mock:
 * Nominatim (OpenStreetMap's free search/reverse API, no key required) backs both the address
 * search box and the drag-the-pin-to-correct-it flow; Leaflet renders the map itself. Google Maps
 * would need a billed API key this project doesn't have — this gets the same real behavior for ₹0.
 */
export function PropertyAddressStep({ onContinue, onCancel }: { onContinue: (addr: PropertyAddress) => void; onCancel: () => void }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  const [apartmentOrFloor, setApartmentOrFloor] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [updateAddressOnDrag, setUpdateAddressOnDrag] = useState(true);
  const [showPinHint, setShowPinHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mount the Leaflet map once.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // dragend/click handlers are bound once (see below) — a ref keeps them reading the latest
  // checkbox value without having to recreate the marker/listener on every toggle.
  const updateAddressOnDragRef = useRef(updateAddressOnDrag);
  useEffect(() => {
    updateAddressOnDragRef.current = updateAddressOnDrag;
  }, [updateAddressOnDrag]);

  /** Moves (or creates) the pin and always records the new position — reverse-geocoding into the
   * address fields only happens when the "update address" checkbox is on, so an owner who already
   * typed the right address can still nudge the pin to the exact spot without it getting clobbered. */
  async function applyPosition(lat: number, lng: number) {
    setPosition({ lat, lng });
    if (updateAddressOnDragRef.current) {
      const result = await nominatimReverse(lat, lng);
      if (result) {
        const f = fieldsFromResult(result);
        setAddressLine(f.addressLine);
        setCity(f.city);
        setState(f.state);
        setPincode(f.pincode);
      }
      setShowPinHint(false);
    } else {
      setShowPinHint(true);
    }
  }

  function placeMarker(lat: number, lng: number, zoom = 16) {
    const map = mapRef.current;
    if (!map) return;
    map.setView([lat, lng], zoom);
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      // Always draggable, and clicking anywhere on the map (below) always moves it too — this is
      // the "set your exact location yourself" path, independent of ever having searched an address.
      const marker = L.marker([lat, lng], { icon: PIN_ICON, draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const { lat: newLat, lng: newLng } = marker.getLatLng();
        void applyPosition(newLat, newLng);
      });
      markerRef.current = marker;
    }
    setPosition({ lat, lng });
  }

  // Debounced search-as-you-type.
  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const results = await nominatimSearch(query);
        setSuggestions(results);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(id);
  }, [query]);

  function selectSuggestion(r: NominatimResult) {
    const f = fieldsFromResult(r);
    setAddressLine(f.addressLine);
    setCity(f.city);
    setState(f.state);
    setPincode(f.pincode);
    setQuery(f.addressLine);
    setSuggestions([]);
    setShowSuggestions(false);
    placeMarker(Number(r.lat), Number(r.lon));
  }

  // Clicking anywhere on the map always drops/moves the pin there — an owner can set their exact
  // location by hand this way, with no address search involved at all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng.lat, e.latlng.lng, map.getZoom());
      void applyPosition(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, []);

  function validateAndContinue() {
    setError(null);
    if (!addressLine.trim() && !position) {
      setError('Search for your address or drop a pin on the map first');
      return;
    }
    onContinue({
      addressLine: addressLine.trim(),
      apartmentOrFloor: apartmentOrFloor.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      latitude: position?.lat ?? null,
      longitude: position?.lng ?? null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="shrink-0 border-b border-slate-100 px-10 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Where is your property?</h1>
      </div>

      {/* Map fills the entire remaining viewport, edge to edge — the form floats over it as its
          own card, matching the reference layout (not a boxed-in grid column). */}
      <div className="relative flex-1">
        {/* z-0 (not just `absolute`) matters here: Leaflet's own panes go up to z-index 700
            (markers/tooltips/popups), and without an explicit z-index of its own this container
            never forms its own stacking context — so those panes compare directly against the
            floating card below instead of staying contained, and paint over it. */}
        <div ref={mapDivRef} className="absolute inset-0 z-0" />

        <div className="absolute left-6 top-6 z-10 max-h-[calc(100%-3rem)] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              validateAndContinue();
            }}
            className="space-y-4"
          >
            <div className="relative">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Find your address</label>
              <input
                className={`${inputClass} w-full`}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Start typing your address"
                autoFocus
              />
              {showSuggestions && (searching || suggestions.length > 0) && (
                <>
                  <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setShowSuggestions(false)} />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {searching && <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>}
                    {suggestions.map((s) => (
                      <button
                        key={`${s.lat}-${s.lon}`}
                        type="button"
                        onClick={() => selectSuggestion(s)}
                        className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-brand-50"
                      >
                        {s.display_name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Apartment or floor number (optional)</label>
              <input className={`${inputClass} w-full`} value={apartmentOrFloor} onChange={(e) => setApartmentOrFloor(e.target.value)} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Country/region</label>
              <select className={`${inputClass} w-full bg-slate-50 text-slate-500`} value="India" disabled>
                <option>India</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">City</label>
                <input className={`${inputClass} w-full`} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Post code / Zip code</label>
                <input className={`${inputClass} w-full`} value={pincode} onChange={(e) => setPincode(e.target.value)} />
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={updateAddressOnDrag}
                onChange={(e) => setUpdateAddressOnDrag(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Update the address when moving the pin on the map.
            </label>

            {showPinHint && (
              <div className="relative flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                <span>ℹ️</span>
                <p className="flex-1">
                  Is the red pin location incorrect? Then uncheck the option above, then click or press on the map to move the pin to the right
                  location.
                </p>
                <button type="button" onClick={() => setShowPinHint(false)} className="shrink-0 text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                ← Back
              </Button>
              <Button type="submit" className="flex-1">
                Continue
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
