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

    /**
     * Escreve os dados do sorteio atual
     * @param bool $extend Opcional. Quando true exibe resultados formatados.
     * @return ILoteria Auto retorno.
     */
    function write(bool $extend = false): ILoteria;

    /**
     * Dados do sorteio como texto.
     * @param bool $extend Opcional. Quando true exibe resultados formatados.
     * @return string Valor.
     */
    function getText(bool $extend = false): string;
}