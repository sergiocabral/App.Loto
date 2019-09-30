<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: DuplaSena
 * @package Loto\LoteriasCaixa
 */
class LoteriaDuplaSena extends Loteria
{

    /**
     * @var string Valor da chave no JSON: Sorteio anterior
     */
    protected $jsonKeyPrevious = "concursoAnterior";

    /**
     * @var string Valor da chave no JSON: Próximo sorteio
     */
    protected $jsonKeyNext = "proximoConcurso";

    /**
     * @var string Valor da chave no JSON: Resultado
     */
    protected $jsonKeyResult1 = "resultado_sorteio1";

    /**
     * @var string Valor da chave no JSON: Resultado
     */
    protected $jsonKeyResult2 = "resultado_sorteio2";

    /**
     * @var string Valor da chave no JSON: Data
     */
    protected $jsonKeyDate = "dataStr";

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
        return "http://loterias.caixa.gov.br/wps/portal/loterias/landing/duplasena/!ut/p/a1/04_Sj9CPykssy0xPLMnMz0vMAfGjzOLNDH0MPAzcDbwMPI0sDBxNXAOMwrzCjA2cDIAKIoEKnN0dPUzMfQwMDEwsjAw8XZw8XMwtfQ0MPM2I02-AAzgaENIfrh-FqsQ9wNnUwNHfxcnSwBgIDUyhCvA5EawAjxsKckMjDDI9FQGgnyPS/dl5/d5/L2dBISEvZ0FBIS9nQSEh/pw/Z7_61L0H0G0J0I280A4EP2VJV30N4/res/id=buscaResultado/c=cacheLevelPage/=/?timestampAjax=1569781577995&concurso=" . $this->getId();
    }

    /**
     * Retorna os resultados do sorteio.
     * @return array Resultados.
     */
    public function getResults(): array
    {
        $result1 = isset($this->results[strtolower($this->jsonKeyResult1)]) ? explode('-', $this->results[strtolower($this->jsonKeyResult1)]) : [];
        $result2 = isset($this->results[strtolower($this->jsonKeyResult2)]) ? explode('-', $this->results[strtolower($this->jsonKeyResult2)]) : [];
        $result = array_merge($result1, $result2);
        $result = array_map("trim", $result);
        return $result;
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