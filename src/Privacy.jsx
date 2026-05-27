import LegalPage, { H2, P, UL, LI } from "./LegalPage";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="May 26, 2026">
      <P>
        TripJam ("we", "us", "our") is a single-founder project that helps people
        plan trips with the help of AI. This Privacy Policy explains what data we
        collect, why, how we use it, and what choices you have. Plain English first,
        legal precision second.
      </P>
      <P>
        <strong>Short version:</strong> We collect the minimum needed to run the app
        (your username, email, the trips you create, basic usage analytics). We don't
        sell your data. We don't run ads. Your trips are private by default. You can
        delete your account anytime.
      </P>

      <H2>1. Who runs this</H2>
      <P>
        TripJam is operated by an individual based in India. For all privacy questions
        or requests, email{" "}
        <a href="mailto:achinj.work@gmail.com" style={{ color: "#2563A8" }}>
          achinj.work@gmail.com
        </a>
        . We aim to reply within 24 hours on weekdays.
      </P>

      <H2>2. What we collect</H2>
      <UL>
        <LI>
          <strong>Account info:</strong> username, email (mandatory at signup or via
          Google sign-in), a chosen avatar emoji, when you signed up.
        </LI>
        <LI>
          <strong>Trip data:</strong> the destinations, dates, preferences,
          itineraries, comments, votes, and AI-generated content you create or save
          in TripJam.
        </LI>
        <LI>
          <strong>Usage analytics:</strong> page views, button clicks, AI feature
          usage, browser, OS, approximate location (city-level from IP) — collected
          via PostHog to understand what works.
        </LI>
        <LI>
          <strong>Error logs:</strong> when something breaks, we capture the error
          and a stack trace via Sentry to fix it. May include your user ID for
          correlation.
        </LI>
        <LI>
          <strong>Payment info:</strong> when you purchase credits, our payment
          processor (Lemon Squeezy) collects your name, email, card details, and
          billing address. We only see the order amount, your email, and the order
          ID — never your full card details.
        </LI>
      </UL>

      <H2>3. Why we use it</H2>
      <UL>
        <LI>To create and manage your account and trips.</LI>
        <LI>To generate AI itineraries, magazines, and chat responses on your behalf.</LI>
        <LI>To process payments and track your credit balance.</LI>
        <LI>To improve the product (which features are used, what breaks).</LI>
        <LI>To respond to your support requests.</LI>
        <LI>To detect abuse (spam, fraud, automated scraping).</LI>
      </UL>

      <H2>4. Third parties we share data with</H2>
      <P>We only share what's strictly needed for these services to do their job:</P>
      <UL>
        <LI>
          <strong>Anthropic (Claude):</strong> your prompts and trip context are sent
          to generate itineraries, magazines, and chat replies. Anthropic processes
          but does not train on the prompts (we use their API, not chat product).
        </LI>
        <LI>
          <strong>Google (Places, OAuth):</strong> place names and city names are
          sent to Google Places to resolve coordinates. If you choose "Sign in with
          Google", Google verifies your identity and returns your email.
        </LI>
        <LI>
          <strong>Lemon Squeezy:</strong> our merchant of record. Handles all payment
          processing, tax, and refunds. They are GDPR-compliant.
        </LI>
        <LI>
          <strong>Supabase:</strong> hosts our database and authentication. Data is
          stored on their managed Postgres instance in their chosen regions.
        </LI>
        <LI>
          <strong>PostHog:</strong> product analytics. Sees your user ID, events,
          and approximate location.
        </LI>
        <LI>
          <strong>Sentry:</strong> error tracking. Sees crash reports including your
          user ID.
        </LI>
        <LI>
          <strong>Vercel:</strong> hosts our web frontend. Serves the app, sees IP
          addresses.
        </LI>
        <LI>
          <strong>OpenStreetMap (Photon, Nominatim), Wikipedia/Wikimedia:</strong>{" "}
          used to look up place coordinates and photos. We only send place names.
        </LI>
      </UL>
      <P>
        We don't sell your personal data. We don't share data for advertising. We
        don't use third-party trackers beyond the services listed above.
      </P>

      <H2>5. Where data lives</H2>
      <P>
        Most data is in Supabase (US/EU regions). Backups are managed by Supabase.
        We retain trip data for as long as your account exists. Analytics data is
        retained per PostHog defaults (~7 years rolling window unless you delete
        your account, in which case we issue a delete request to PostHog).
      </P>

      <H2>6. Your rights</H2>
      <UL>
        <LI>
          <strong>Access:</strong> email us and we'll export your trip data and
          account info as JSON within 30 days.
        </LI>
        <LI>
          <strong>Delete:</strong> email us to delete your account. Within 30 days
          we will permanently delete your profile, trips, comments, votes, and
          credit history. Payment records (for tax/legal compliance) may be retained
          by Lemon Squeezy per their policy.
        </LI>
        <LI>
          <strong>Correction:</strong> you can update your email + username in the
          app directly. Other corrections — email us.
        </LI>
        <LI>
          <strong>Opt-out of analytics:</strong> install a browser extension that
          blocks PostHog (e.g. uBlock Origin), or use a privacy-focused browser.
        </LI>
      </UL>

      <H2>7. Cookies + local storage</H2>
      <P>
        We use cookies and browser local storage for authentication (so you stay
        signed in) and to remember UI preferences (e.g. dismissed banners). We
        don't use third-party advertising cookies.
      </P>

      <H2>8. Children</H2>
      <P>
        TripJam is for users 13 and older. If you're under 13, please don't sign
        up. If a parent or guardian believes their child has signed up, email us
        and we'll delete the account.
      </P>

      <H2>9. Changes to this policy</H2>
      <P>
        We'll update the "Last updated" date at the top whenever this policy
        changes. For major changes, we'll notify active users by email. Continued
        use of TripJam after changes means you accept the new policy.
      </P>

      <H2>10. Jurisdiction</H2>
      <P>
        TripJam is operated from India. By using the service, you consent to your
        data being processed in jurisdictions where our service providers operate
        (primarily the US and EU). Disputes are governed by Indian law.
      </P>

      <H2>11. Contact</H2>
      <P>
        Privacy questions, data export requests, or anything else — email{" "}
        <a href="mailto:achinj.work@gmail.com" style={{ color: "#2563A8" }}>
          achinj.work@gmail.com
        </a>
        .
      </P>
    </LegalPage>
  );
}
