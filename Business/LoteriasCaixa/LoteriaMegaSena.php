<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: MegaSena
 * @package Loto\LoteriasCaixa
 */
class LoteriaMegaSena extends Loteria
{

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
        return "https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena/" . $this->getId();
    }
}