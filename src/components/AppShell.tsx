import Link from "next/link";
import { getAppVersion } from "@/lib/render";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1>
        <Link href="/">Loterias da Caixa</Link>
        <em>{getAppVersion()}</em>
      </h1>
      {children}
    </>
  );
}
