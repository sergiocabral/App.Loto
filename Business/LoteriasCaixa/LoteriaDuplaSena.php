<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: DuplaSena
 * @package Loto\LoteriasCaixa
 */
class LoteriaDuplaSena extends Loteria
{

    /**
     * @var int Total de números possíveis nos sorteios.
     */
    protected $countNumbers = 50;

    /**
     * Retorna a url para retorno dos dados do sorteio atual.
     * @return string Url.
     */
    protected function getUrl(): string
    {
        return "https://servicebus2.caixa.gov.br/portaldeloterias/api/duplasena/" . $this->getId();
    }

    /**
     * Retorna os grupos dos resultados do sorteio.
     * @return array Resultados.
     */
    public function getResultsGroups(): array
    {
        $result = $this->getResults();
        return count($result) ? [array_slice($result, 0, 6), array_slice($result, 6, 6)] : [];
    }

    /**
     * Dados do sorteio como texto.
     * @param bool $extend Opcional. Quando true exibe resultados formatados.
     * @return string Valor.
     */
    public function getText(bool $extend = false): string {
        $text = "";
        $results = $this->getResultsGroups();

        if (count($results)) {
            $date = $this->getDate();

            $text .= str_pad($this->id, $this->paddingId, '0', STR_PAD_LEFT) . ' | ';
            $text .= $date . ' | ';

            $text .= implode(' ', $results[0]);
            if ($extend) {
                $formatted = $this->format($results[0]);
                if (!empty($formatted)) $text .= ' | ' . $formatted;
            }

            $text .= PHP_EOL;

            $text .= str_repeat(' ', $this->paddingId) . ' | ';
            $text .= str_repeat(' ', strlen($date)) . ' | ';

            $text .= implode(' ', $results[1]);
            if ($extend) {
                $formatted = $this->format($results[1]);
                if (!empty($formatted)) $text .= ' | ' . $formatted;
            }

            $text .= PHP_EOL;
            $text .= str_repeat('-', (strlen($text) - strlen(PHP_EOL) * 2) / 2) . PHP_EOL;
        }

        return $text;
    }
}