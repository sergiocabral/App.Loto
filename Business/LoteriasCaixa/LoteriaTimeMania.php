<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: TimeMania
 * @package Loto\LoteriasCaixa
 */
class LoteriaTimeMania extends Loteria
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
    protected $jsonKeyResult = "de_RESULTADO";

    /**
     * @var string Valor da chave no JSON: Data
     */
    protected $jsonKeyDate = "dt_APURACAOStr";

    /**
     * @var int Total de números possíveis nos sorteios.
     */
    protected $countNumbers = 80;

    /**
     * Retorna a url para retorno dos dados do sorteio atual.
     * @return string Url.
     */
    protected function getUrl(): string
    {
        return "http://loterias.caixa.gov.br/wps/portal/loterias/landing/timemania/!ut/p/a1/04_Sj9CPykssy0xPLMnMz0vMAfGjzOLNDH0MPAzcDbz8vTxNDRy9_Y2NQ13CDA1MzIEKIoEKnN0dPUzMfQwMDEwsjAw8XZw8XMwtfQ0MPM2I02-AAzgaENIfrh-FqsQ9wBmoxN_FydLAGAgNTKEK8DkRrACPGwpyQyMMMj0VASrq9qk!/dl5/d5/L2dBISEvZ0FBIS9nQSEh/pw/Z7_61L0H0G0JGJVA0AKLR5T3K00M4/res/id=buscaResultado/c=cacheLevelPage/=/?timestampAjax=1569781569081&concurso=" . $this->getId();
    }
}