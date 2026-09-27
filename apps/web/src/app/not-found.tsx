import { PublicLayout } from "./public-content";

export default function NotFound() {
  return (
    <PublicLayout configuration={null} menu={null}>
      <section className="empty-state">
        <p className="content-kicker">Nexora</p>
        <h1>Página não encontrada</h1>
        <p>O endereço solicitado não corresponde a um conteúdo publicado.</p>
      </section>
    </PublicLayout>
  );
}
