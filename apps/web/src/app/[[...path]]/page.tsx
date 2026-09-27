import { notFound, permanentRedirect, redirect } from "next/navigation";
import { PublicContent, PublicLayout } from "../public-content";
import { loadPublicPage, publicPath } from "../../lib/public-site";

type PublicPageProperties = {
  params: Promise<{ path?: string[] }>;
};

export default async function PublicPage({ params }: Readonly<PublicPageProperties>) {
  const { path } = await params;
  const data = await loadPublicPage(publicPath(path));

  if (data.route?.kind === "redirect") {
    if (data.route.statusCode === 301 || data.route.statusCode === 308) {
      permanentRedirect(data.route.location);
    }
    redirect(data.route.location);
  }
  if (data.status === "not-found") notFound();

  return (
    <PublicLayout configuration={data.configuration} menu={data.menu}>
      {data.status === "unavailable" ? (
        <section className="service-state">
          <p className="content-kicker">Nexora</p>
          <h1>Site temporariamente indisponível</h1>
          <p>Não foi possível carregar o conteúdo publicado neste momento.</p>
        </section>
      ) : data.content ? (
        <PublicContent content={data.content} />
      ) : (
        <section className="empty-state">
          <p className="content-kicker">Nexora</p>
          <h1>{data.configuration?.site.identity?.displayName ?? "Conteúdo em preparação"}</h1>
          <p>
            {data.configuration?.site.identity?.description ??
              "Esta página ainda não possui conteúdo publicado."}
          </p>
        </section>
      )}
    </PublicLayout>
  );
}
