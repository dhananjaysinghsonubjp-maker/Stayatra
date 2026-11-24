import { DateFilterPill, dateRangeKeys } from '../../components/DateRangePicker';

/**
 * §user request — "ye simple esa hona chaiye aur Select Date Range aana chaiye, custom me calendar
 * view jo hum daalte hai": the plain pair of native `<input type="date">` boxes across the new
 * Reports pages read as a glitch (two separate "fill this in" fields for one range) next to a
 * reference app's own single "Select Date Range" dropdown with a calendar popup. Reuses this app's
 * own existing MultiDatePicker/DateFilterPill (already built for Housekeeping's date filter and
 * the Channel Manager Calendar's view-range picker) instead of a new picker — same pill, same
 * calendar, just wrapped to speak plain `from`/`to` strings like these report pages already use.
 */
export function ReportDateRangePill({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <DateFilterPill
      selected={from && to ? dateRangeKeys(from, to) : []}
      onChange={(dates) => {
        if (dates.length === 0) return;
        onChange(dates[0], dates[dates.length - 1]);
      }}
    />
  );
}
