import { CHANNEL_META, SOURCE_LABEL } from './ota-labels';
import mmtLogo from '../../assets/logos/mmt.png';
import bookingLogo from '../../assets/logos/booking.png';
import airbnbLogo from '../../assets/logos/airbnb.jpg';
import expediaLogo from '../../assets/logos/expedia.png';

/** Real logo files, where we have one — falls back to the CHANNEL_META monogram for every
 * channel that doesn't (Agoda, Cleartrip, EaseMyTrip, Yatra, Direct, Walk-in). Add more here as
 * logo files are sourced for the rest. */
const CHANNEL_LOGO: Partial<Record<string, string>> = {
  mmt_goibibo: mmtLogo,
  booking_com: bookingLogo,
  airbnb: airbnbLogo,
  expedia: expediaLogo,
};

/** Just the icon — a real logo where we have one, else the CHANNEL_META monogram. Used anywhere
 * a channel needs a compact mark with no label alongside (Calendar's booking bars and legend). */
export function ChannelIcon({ source, className = 'h-5 w-5' }: { source: string; className?: string }) {
  const logo = CHANNEL_LOGO[source];
  const meta = CHANNEL_META[source] ?? CHANNEL_META.direct;
  return logo ? (
    <img src={logo} alt={SOURCE_LABEL[source] ?? source} className={`${className} shrink-0 rounded-md object-cover`} />
  ) : (
    <span className={`flex ${className} shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${meta.bg} ${meta.text}`}>{meta.letter}</span>
  );
}

/** Icon + full name for a booking's channel. */
export function ChannelBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ChannelIcon source={source} />
      <span>{SOURCE_LABEL[source] ?? source}</span>
    </span>
  );
}
