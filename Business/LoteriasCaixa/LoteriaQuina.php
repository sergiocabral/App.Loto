<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Manipulação de dados de loteria: Quina
 * @package Loto\LoteriasCaixa
 */
class LoteriaQuina extends Loteria
{

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
        return "https://servicebus2.caixa.gov.br/portaldeloterias/api/quina/" . $this->getId();
    }
}