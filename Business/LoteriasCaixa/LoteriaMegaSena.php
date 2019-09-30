<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: MegaSena
 * @package Loto\LoteriasCaixa
 */
class LoteriaMegaSena extends Loteria
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
    protected $jsonKeyResult = "resultado";

    /**
     * @var string Valor da chave no JSON: Data
     */
    protected $jsonKeyDate = "dataStr";

    /**
     * @var int Total de números possíveis nos sorteios.
     */
    protected $countNumbers = 60;

    /**
     * Retorna a url para retorno dos dados do sorteio atual.
     * @return string Url.
     */
    protected function getUrl(): string
    {
        return "http://loterias.caixa.gov.br/wps/portal/loterias/landing/megasena/!ut/p/a1/04_Sj9CPykssy0xPLMnMz0vMAfGjzOLNDH0MPAzcDbwMPI0sDBxNXAOMwrzCjA0sjIEKIoEKnN0dPUzMfQwMDEwsjAw8XZw8XMwtfQ0MPM2I02-AAzgaENIfrh-FqsQ9wNnUwNHfxcnSwBgIDUyhCvA5EawAjxsKckMjDDI9FQE-F4ca/dl5/d5/L2dBISEvZ0FBIS9nQSEh/pw/Z7_HGK818G0KO6H80AU71KG7J0072/res/id=buscaResultado/c=cacheLevelPage/=/?timestampAjax=1569781369414&concurso=" . $this->getId();
    }
}