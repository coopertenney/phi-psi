# Deploying the prototype (shareable demo)

The app runs entirely on **mock data** — no database, no env vars, no secrets.
That makes it trivial to put on a public URL so you can send it around and click
through it on any device.

## Fastest path — Vercel CLI (no git needed)

From this folder (`chapter-app/`):

```bash
npx vercel          # first run: prompts you to log in (email or GitHub), then
                    # links the project and deploys a PREVIEW url
npx vercel --prod   # promotes it to your PRODUCTION url (the one to share)
```

That's it. The login is a one-time browser step in your terminal; the deploy
itself takes ~1 minute. No environment variables to set — leave them blank and
the app serves the mock seed.

## Alternative — GitHub → Vercel (auto-deploys on every push)

If you'd rather have it redeploy automatically when the code changes:

1. Create an empty GitHub repo (e.g. `pkp-chapter-app`).
2. From `chapter-app/`:
   ```bash
   git init && git add -A && git commit -m "Chapter app prototype"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
3. In the Vercel dashboard: **Add New → Project → import the repo**. Framework
   auto-detects as Next.js; no env vars needed. Every push to `main` redeploys.

(Ask me and I'll run the `git init`/commit for you.)

## Notes

- `npm run build` is verified green — 11 static routes, ~90 kB first load.
- The demo is **stateful in-session but resets on refresh** (no backend yet), so
  every reload gives a clean seed — handy for repeated walkthroughs.
- The Exec/Member toggle (top-right) flips between the two role experiences and
  now persists across refreshes.
- When you're ready to make data actually persist, that's the Supabase step —
  separate from this deploy.

## Adding Stripe (real dues payments)

Once Supabase is live (see CLAUDE.md), dues/fines payments go through Stripe
Checkout. Run `app-foundation/stripe-dues.sql` once in the Supabase SQL editor
first — it adds the Finance Officer's on/off switch (`chapters.dues_payments_enabled`,
defaults to **off**) and RLS on the `chapters` table. Then run
`app-foundation/payments-idempotency.sql` (also once) — it adds the unique index
that stops a Stripe payment from being recorded twice when the webhook and the
success-return verifier race. Safe to run before or after deploying the code.

1. **Stripe account**: create one at stripe.com (or reuse an existing one),
   business type "unincorporated association" fits most chapters. Start in
   **test mode** — the toggle keys (top-right of the Dashboard) switch you to
   live mode once you're ready to take real money.
2. **API key**: Dashboard → Developers → API keys → copy the **Secret key**
   (`sk_test_...` / `sk_live_...`) into `STRIPE_SECRET_KEY`.
3. **Webhook**: Dashboard → Developers → Webhooks → Add endpoint.
   - URL: `https://<your-vercel-domain>/api/stripe/webhook`
   - Events to send: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   - Copy the endpoint's **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. **Supabase service role key**: Supabase Dashboard → Project Settings → API
   → `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`. This is what lets the
   webhook write to `payments` without a logged-in user session. Never expose
   it to the browser (it's not `NEXT_PUBLIC_*`).
5. Add all four (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`) to Vercel: **Project →
   Settings → Environment Variables**, then redeploy.
6. Flip `chapters.dues_payments_enabled` to `true` for your chapter (either the
   commented `update` at the bottom of `stripe-dues.sql`, or the "Online dues
   payments" toggle on the Finances tab, exec view — no redeploy needed).

Testing locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
(Stripe CLI) forwards webhook events to your dev server and prints a
`whsec_...` you can drop into `.env.local` for local testing. Use Stripe's
[test cards](https://docs.stripe.com/testing) (e.g. `4242 4242 4242 4242`) —
never a real card in test mode.

**Each year, when the FO/treasurer changes**: leave `dues_payments_enabled` off
until the new officer has linked their chapter's Stripe account and you've
swapped in the new `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`. Brothers see a
"ask your treasurer" message instead of a broken Pay button in the meantime.
