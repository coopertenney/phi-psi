import { getLineageRoster } from '@/lib/data';
import { LineageScreen } from '@/components/LineageScreen';

// Full-chapter lineage tree. Uses getLineageRoster (NOT getMembers) so it also
// includes alumni (status 'inactive') — they render their big–little history here
// and nowhere else. bigName/littleNames come from the live `member_standings`
// view (or the mock seed). Click any brother to trace his line.
export default async function LineagePage() {
  const members = await getLineageRoster();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--ink-500)', fontSize: 14, margin: 0, maxWidth: '72ch' }}>
        Every brother’s big–little line, oldest generation at the top. Bright circles are current
        brothers; faded circles are alumni. Click any brother to light up his whole line, or search by name.
      </p>
      <LineageScreen members={members} />
    </div>
  );
}
