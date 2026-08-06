'use server';

import { createPointItem, updatePointItem, archivePointItem, updateSettings, startNewTerm } from '../actions';

// Points are always stored signed by kind — a "punishment" catalog value is
// negative, a "reward" positive — so rewardPunishmentSplit (which splits on
// sign) and the public board agree with what the exec picked in the dropdown.
function signedByKind(points: number, kind: 'reward' | 'punishment'): number {
  const abs = Math.abs(points);
  return kind === 'punishment' ? -abs : abs;
}

export async function createPointItemForm(formData: FormData) {
  const kind = (formData.get('kind') as 'reward' | 'punishment') ?? 'reward';
  await createPointItem({
    label: String(formData.get('label') ?? ''),
    points: signedByKind(Number(formData.get('points') ?? 0), kind),
    kind,
    discretionary: formData.get('discretionary') === 'on',
  });
}

export async function updatePointItemForm(formData: FormData) {
  const itemId = String(formData.get('itemId') ?? '');
  const kind = (formData.get('kind') as 'reward' | 'punishment') ?? 'reward';
  const maxPerTermRaw = String(formData.get('maxPerTerm') ?? '');
  const autoTriggerRaw = String(formData.get('autoTrigger') ?? '');
  await updatePointItem(itemId, {
    label: String(formData.get('label') ?? ''),
    points: signedByKind(Number(formData.get('points') ?? 0), kind),
    kind,
    discretionary: formData.get('discretionary') === 'on',
    maxPerTerm: maxPerTermRaw === '' ? null : Number(maxPerTermRaw),
    autoTrigger: autoTriggerRaw === '' ? null : (autoTriggerRaw as any),
  });
}

export async function archivePointItemForm(formData: FormData) {
  const itemId = String(formData.get('itemId') ?? '');
  const archived = String(formData.get('archived') ?? 'true') === 'true';
  await archivePointItem(itemId, archived);
}

export async function updateSettingsForm(formData: FormData) {
  const ceilingRaw = String(formData.get('ceiling') ?? '');
  await updateSettings({
    floor: Number(formData.get('floor') ?? -5),
    ceiling: ceilingRaw === '' ? null : Number(ceilingRaw),
  });
}

export async function startNewTermForm(formData: FormData) {
  await startNewTerm(String(formData.get('label') ?? ''));
}
