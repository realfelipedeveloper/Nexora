import { foundationStatus } from "@nexora/contracts";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Nexora public site</p>
        <h1>Universal content, site-ready delivery.</h1>
        <p>
          The public app is wired as a neutral consumer of CMS capabilities. It does not embed
          portfolio-specific domain rules.
        </p>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{foundationStatus.status}</dd>
          </div>
          <div>
            <dt>Core</dt>
            <dd>{foundationStatus.core}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
