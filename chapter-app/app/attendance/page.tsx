import { redirect } from 'next/navigation';

// Attendance was merged into the Points & Attendance tab (/points). Keep the old
// route alive so bookmarks and any lingering links land on the combined view.
export default function AttendancePage() {
  redirect('/points');
}
