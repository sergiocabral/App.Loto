<?php


namespace Loto\Business\LoteriasCaixa;

use Loto\Util\Execution;
use Loto\Util\Web;

/**
 * Manipulação de dados de loteria: DuplaSena
 * @package Loto\LoteriasCaixa
 */
class LoteriaDuplaSena extends LoteriaBase
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
        $result1 = explode('-', $this->results[strtolower($this->jsonKeyResult1)]);
        $result2 = explode('-', $this->results[strtolower($this->jsonKeyResult2)]);
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
     * Escreve os dados do sorteio atual
     * @return ILoteria Auto retorno.
     */
    public function write(): ILoteria {
        $results = $this->getResultsGroups();

        if (count($results)) {
            $date = $this->getDate();

            echo str_pad($this->id, $this->paddingId, '0', STR_PAD_LEFT) . ' | ';
            echo $date . ' | ';

            echo implode('-', $results[0]);
            $formatted = $this->format($results[0]);
            if (!empty($formatted)) echo ' | ' . $formatted;

            echo Execution::newline();

            echo str_repeat(' ', $this->paddingId) . ' | ';
            echo str_repeat(' ', strlen($date)) . ' | ';

            echo implode('-', $results[1]);
            $formatted = $this->format($results[1]);
            if (!empty($formatted)) echo ' | ' . $formatted;

            echo Execution::newline();
        }

        return $this;
    }
}