import { type NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getServerSupabase } from '@/lib/supabase/server';

// Where the invite/reset email link lands. It carries a one-time token_hash;
// we verify it (which sets the session cookies), then send the user on to set
// their password. Configure the "Invite user" email template to point here:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // Only honor relative next paths (no open redirect).
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/set-password';

  if (token_hash && type) {
    const supabase = getServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Bad/expired link → back to login with a hint.
  return NextResponse.redirect(new URL('/login?error=link_expired', origin));
}
