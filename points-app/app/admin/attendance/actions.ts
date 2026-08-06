'use server';

import { redirect } from 'next/navigation';
import { recordAttendance, setTermStatus, clearTermStatus } from '../actions';
import type { AttendanceState } from '@/lib/types';

export async function createMeetingForm(formData: FormData) {
  const title = String(formData.get('title') ?? '');
  const heldOn = String(formData.get('heldOn') ?? '');
  const meetingId = await recordAttendance({ meetingId: null, title, heldOn, entries: [] });
  redirect(`/admin/attendance?meeting=${meetingId}`);
}

export async function recordAttendanceForm(formData: FormData) {
  const meetingId = String(formData.get('meetingId') ?? '');
  const memberIds = String(formData.get('memberIds') ?? '').split(',').filter(Boolean);
  const entries = memberIds.map((memberId) => ({
    memberId,
    state: String(formData.get(`state-${memberId}`) ?? 'present') as AttendanceState,
  }));
  await recordAttendance({ meetingId, title: '', heldOn: '', entries });
  redirect(`/admin/attendance?meeting=${meetingId}`);
}

export async function setTermStatusForm(formData: FormData) {
  const memberId = String(formData.get('memberId') ?? '');
  const kind = String(formData.get('kind') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!kind) {
    await clearTermStatus(memberId);
  } else {
    await setTermStatus(memberId, kind as 'abroad' | 'excused', reason);
  }
}
