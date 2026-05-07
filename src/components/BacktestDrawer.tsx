"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function getEligibleCutoffs(draws: Draw[]): Draw[] {
  if (draws.length < 2) {
    return [];
  }

  return draws.slice(1);
}

export function BacktestDrawer({
  draws,
  lottery,
  onClose,
  open,
}: BacktestDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  const eligibleCutoffs = useMemo(() => getEligibleCutoffs(draws), [draws]);
  const [cutoffDrawNumber, setCutoffDrawNumber] = useState<number | null>(null);

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

  const activeCutoffDrawNumber = useMemo(() => {
    if (!eligibleCutoffs.length) {
      return null;
    }

    const exists = eligibleCutoffs.some((draw) => draw.drawNumber === cutoffDrawNumber);

    if (exists) {
      return cutoffDrawNumber;
    }

    return eligibleCutoffs[0].drawNumber;
  }, [cutoffDrawNumber, eligibleCutoffs]);

  function handleCutoffChange(value: string) {
    const numeric = Number.parseInt(value, 10);
    setCutoffDrawNumber(Number.isFinite(numeric) ? numeric : null);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="backtest-drawer__root">
      <button aria-label="Fechar simulador" className="backtest-drawer__backdrop" onClick={onClose} type="button" />
      <div aria-labelledby="backtest-title" aria-modal="true" className="backtest-drawer__panel" role="dialog">
        <header className="backtest-drawer__header">
          <div>
            <span className="eyebrow">Simulador</span>
            <h2 id="backtest-title">Sorteios anteriore</h2>
            {lottery ? <p>{formatLotteryName(lottery.slug)}</p> : null}
          </div>
          <button aria-label="Fechar simulador" className="backtest-drawer__close" onClick={onClose} ref={closeButtonRef} type="button">
            X
          </button>
        </header>
        <div className="backtest-drawer__body">
          {!eligibleCutoffs.length ? (
            <div className="backtest-drawer__placeholder">
              <strong>Sem concursos anteriores suficientes</strong>
              <span className="backtest-drawer__meta">Carregue mais resultados para usar o simulador.</span>
            </div>
          ) : (
            <BacktestCutoffPicker
              cutoffs={eligibleCutoffs}
              onChange={handleCutoffChange}
              value={activeCutoffDrawNumber}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type BacktestCutoffPickerProps = {
  cutoffs: Draw[];
  onChange: (value: string) => void;
  value: number | null;
};

function BacktestCutoffPicker({ cutoffs, onChange, value }: BacktestCutoffPickerProps) {
  return (
    <section aria-label="Selecionar concurso de corte" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Voltar para</h3>
        <span className="backtest-drawer__section-hint">
          Posicione-se em um concurso passado para consultar a lista de sorteios anteriores.
        </span>
      </header>
      <label className="backtest-drawer__field">
        <span>Concurso de corte</span>
        <select
          aria-label="Concurso de corte"
          className="backtest-drawer__select"
          onChange={(event) => onChange(event.target.value)}
          value={value ?? ""}
        >
          {cutoffs.map((draw) => (
            <option key={draw.drawNumber} value={draw.drawNumber}>
              Concurso {draw.drawNumber} · {draw.date}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
