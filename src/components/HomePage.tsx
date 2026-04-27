import { LOTTERIES } from "@/data/lotteries";

export function HomePage() {
  return (
    <>
      <h2>Use uma das opções:</h2>
      <ul>
        {LOTTERIES.map((lottery) => (
          <li key={lottery.slug}>
            <h3>
              <a href={`?${lottery.slug}`}>{lottery.slug}</a>
            </h3>
          </li>
        ))}
      </ul>
    </>
  );
}
