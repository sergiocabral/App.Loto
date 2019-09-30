<?php


namespace Loto\Business\LoteriasCaixa;

/**
 * Interface para classes que manipulam loterias.
 * @package Loto\LoteriasCaixa
 */
interface ILoteria
{

    /**
     * Retorna o nome do sorteio.
     * @return string Valor.
     */
    function getName(): string;

    /**
     * Retorna o identificador do sorteio.
     * @return int Valor.
     */
    function getId(): int;

    /**
     * Retorna o último Id de sorteio no arquivo.
     * @return int Valor.
     */
    function getIdFromFile(): int;

    /**
     * Retorna o caminho do arquivo com os dados gravados.
     * @return string Valor.
     */
    function getFile(): string;

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
     * Escreve os dados do sorteio atual no arquivo.
     * @return ILoteria Auto retorno.
     */
    function writeToFile(): ILoteria;

    /**
     * Dados do sorteio como texto.
     * @param bool $extend Opcional. Quando true exibe resultados formatados.
     * @return string Valor.
     */
    function getText(bool $extend = false): string;
}