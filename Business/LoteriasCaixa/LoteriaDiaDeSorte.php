<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: DiaDeSorte
 * @package Loto\LoteriasCaixa
 */
class LoteriaDiaDeSorte extends Loteria
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
    protected $countNumbers = 31;

    /**
     * Retorna a url para retorno dos dados do sorteio atual.
     * @return string Url.
     */
    protected function getUrl(): string
    {
        return "http://loterias.caixa.gov.br/wps/portal/loterias/landing/diadesorte/!ut/p/a1/jc5BDsIgFATQs3gCptICXdKSfpA2ujFWNoaVIdHqwnh-sXFr9c_qJ2-SYYGNLEzxmc7xkW5TvLz_IE6WvCoUwZPwArpTnZWD4SCewTGDlrQtZQ-gVGs401gj6wFw4r8-vpzGr_6BhZmIoocFYUO7toLemqYGz0H1AUsTZ7Cw4X7dj0hu9QIyUWUw/dl5/d5/L2dBISEvZ0FBIS9nQSEh/pw/Z7_HGK818G0KO5GE0Q8PTB11800G3/res/id=buscaResultado/c=cacheLevelPage/=/?timestampAjax=1569781531242&concurso=" . $this->getId();
    }
}