import { signIn } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main>
      <h1>Points &amp; Attendance</h1>
      <p className="sub">Exec sign-in.</p>
      <form action={signIn} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required style={{ width: '100%' }} />
        </div>
        {searchParams.error && <p className="error">{searchParams.error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
