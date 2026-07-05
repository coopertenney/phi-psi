import { getMembers } from '@/lib/data';
import { LineageScreen } from '@/components/LineageScreen';

// Full-chapter lineage tree. Reads the roster (bigName/littleNames come from the
// live `member_standings` view, or the mock seed) and renders the whole big–little
// forest — click any brother to trace his line.
export default async function LineagePage() {
  const members = await getMembers();
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
