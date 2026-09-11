import { initialFieldTypes } from "@nexora/schemas";

export default function CmsHomePage() {
  return (
    <main className="workspace">
      <header>
        <p>Nexora CMS</p>
        <h1>Content model foundation</h1>
      </header>
      <section className="grid" aria-label="Initial field types">
        {initialFieldTypes.map((field) => (
          <article key={field} className="tile">
            {field}
          </article>
        ))}
      </section>
    </main>
  );
}
