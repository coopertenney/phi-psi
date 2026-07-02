import { getMembers, getMeetings, getAttendance } from '@/lib/data';
import { AttendanceScreen } from '@/components/AttendanceScreen';

export default async function AttendancePage() {
  const [members, meetings, attendance] = await Promise.all([
    getMembers(), getMeetings(), getAttendance(),
  ]);
  return <AttendanceScreen members={members} meetings={meetings} attendance={attendance} />;
}
