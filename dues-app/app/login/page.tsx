import { signIn } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Phi Kappa Psi · Cal Beta</div>
        <h1>Dues Desk</h1>
        <p>Exec sign-in. Brothers don&rsquo;t need an account — the balances page is open.</p>
      </header>

      <form action={signIn} className="panel" style={{ maxWidth: 360 }}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {searchParams.error && <p className="err">{searchParams.error}</p>}
        <div className="acts">
          <button className="btn-primary" type="submit">Sign in</button>
          <a className="btn" href="/balances" style={{ textDecoration: 'none' }}>What do I owe?</a>
        </div>
      </form>
    </div>
  );
}
