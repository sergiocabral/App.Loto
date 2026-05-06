"use client";

import { useEffect, useRef } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import type { Draw } from "@/lib/types";

type BacktestDrawerProps = {
  open: boolean;
  onClose: () => void;
  draws: Draw[];
  lottery: LotteryDefinition | null;
};

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function BacktestDrawer({ draws, lottery, onClose, open }: BacktestDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousActiveElement?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="backtest-drawer__root">
      <button aria-label="Fechar teste histórico" className="backtest-drawer__backdrop" onClick={onClose} type="button" />
      <div aria-labelledby="backtest-title" aria-modal="true" className="backtest-drawer__panel" role="dialog">
        <header className="backtest-drawer__header">
          <div>
            <span className="eyebrow">Backtest</span>
            <h2 id="backtest-title">Testar no passado</h2>
            {lottery ? <p>{formatLotteryName(lottery.slug)}</p> : null}
          </div>
          <button aria-label="Fechar teste histórico" className="backtest-drawer__close" onClick={onClose} ref={closeButtonRef} type="button">
            X
          </button>
        </header>
        <div className="backtest-drawer__body">
          <div className="backtest-drawer__placeholder">
            <strong>Em construção — aguarde a próxima sub-issue</strong>
            <span className="backtest-drawer__meta">
              {draws.length} concurso{draws.length === 1 ? "" : "s"} carregado{draws.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
