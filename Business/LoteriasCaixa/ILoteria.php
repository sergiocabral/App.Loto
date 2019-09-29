<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Interface para classes que manipulam loterias.
 * @package Loto\LoteriasCaixa
 */
interface ILoteria
{

    /**
     * Retorna o identificador do sorteio.
     * @return int Valor.
     */
    function getId(): int;

    /**
     * Retorna os resultados do sorteio.
     * @return array Resultados.
     */
    function getResults(): array;

    /**
     * Define o identificador do sorteio.
     * @param int $id Identificador do sorteio.
     * @return ILoteria Auto retorno.
     */
    function setId(int $id): ILoteria;

    /**
     * Incrementa o sorteio.
     * @return ILoteria Auto retorno.
     */
    function nextId(): ILoteria;

    /**
     * Decrementa o sorteio.
     * @return ILoteria Auto retorno.
     */
    function previousId(): ILoteria;

    /**
     * Carrega os dados do sorteio.
     * @return ILoteria Auto retorno.
     */
    function load(): ILoteria;
}