import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-shell">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <Link aria-label="Voltar para o início" className="brand-home not-found-brand" href="/">
          <Image alt="Luckygames" className="brand-icon" height={72} priority src="/gohorse.png" width={72} />
          <span>Luckygames</span>
        </Link>

        <div className="not-found-content">
          <span className="not-found-code">404</span>
          <h1 id="not-found-title">Esse bilhete saiu voando do globo.</h1>
          <p>
            A página sorteada não existe por aqui. Volte para a página inicial e escolha uma loteria válida.
          </p>
          <Link className="raw-page-link" href="/">
            Voltar para o Luckygames
          </Link>
        </div>
      </section>
    </main>
  );
}
