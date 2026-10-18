// Line icons for the tab bar (24 px grid, drawn with the text color).

type TabId = 'train' | 'gtg' | 'tests' | 'progress' | 'settings';

/** Gear outline: `teeth` flat-topped teeth around a ring. */
function gearPath(teeth = 8, inner = 7.4, outer = 10, c = 12): string {
  const step = (Math.PI * 2) / teeth;
  const at = (r: number, a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(at(inner, a - step * 0.3), at(outer, a - step * 0.17), at(outer, a + step * 0.17), at(inner, a + step * 0.3));
  }
  return `M${pts.join(' L')} Z`;
}

const GEAR = gearPath();

export function TabIcon({ tab }: { tab: TabId }) {
  return (
    <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tab === 'train' && (
        // Stopwatch
        <>
          <circle cx="12" cy="13.5" r="8" />
          <path d="M12 9.5v4l2.6 1.8M9.5 2.5h5M12 2.5v3M18.6 6.4l1.4-1.4" />
        </>
      )}
      {tab === 'gtg' && (
        // Repeat: sets spread through the day
        <path d="M17 2.5 20.5 6 17 9.5M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5" />
      )}
      {tab === 'tests' && (
        // Target
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" />
        </>
      )}
      {tab === 'progress' && (
        // Bar chart
        <path d="M3.5 20.5h17M7 17v-5M12 17V6M17 17V9.5" strokeWidth="2.6" />
      )}
      {tab === 'settings' && (
        // Gear
        <>
          <path d={GEAR} />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
