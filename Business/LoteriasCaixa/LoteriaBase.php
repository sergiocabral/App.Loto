<?php


namespace Loto\Business\LoteriasCaixa;

use Loto\Util\Web;

/**
 * Classe base das classes de manipulação de dados de loteria.
 * @package Loto\LoteriasCaixa
 */
abstract class LoteriaBase implements ILoteria
{
    /**
     * Retorna a url para retorno dos dados do sorteio atual.
     * @return string Url.
     */
    protected abstract function getUrl(): string;

    /**
     * @var string Valor da chave no JSON para o sorteio anterior.
     */
    protected $jsonKeyPrevious = "concursoAnterior";

    /**
     * @var string Valor da chave no JSON para o próximo sorteio.
     */
    protected $jsonKeyNext = "proximoConcurso";

    /**
     * @var int Identificador do sorteio atual.
     */
    private $id = 1;

    /**
     * @var array Dados do sorteio atual.
     */
    private $results = [];

    /**
     * Retorna o identificador do sorteio.
     * @return int Valor.
     */
    public function getId(): int
    {
        return $this->id;
    }

    /**
     * Retorna os resultados do sorteio.
     * @return array Resultados.
     */
    public function getResults(): array
    {
        return $this->results;
    }

    /**
     * Define o identificador do sorteio.
     * @param int $id Identificador do sorteio.
     * @return ILoteria Auto retorno.
     */
    public function setId(int $id): ILoteria
    {
        $this->id = $id;
        if ($this->id < 1) $this->id = 1;
        return $this;
    }

    /**
     * Incrementa o sorteio.
     * @return ILoteria Auto retorno.
     */
    public function nextId(): ILoteria
    {
        if (isset($this->results[$this->jsonKeyNext])) {
            $this->id = (int)$this->results[$this->jsonKeyNext];
        } else {
            $this->id++;
        }
        return $this;
    }

    /**
     * Decrementa o sorteio.
     * @return ILoteria Auto retorno.
     */
    public function previousId(): ILoteria
    {
        if (isset($this->results[$this->jsonKeyPrevious])) {
            $this->id = (int)$this->results[$this->jsonKeyPrevious];
        } else {
            $this->id--;
            if ($this->id < 1) $this->id = 1;
        }
        return $this;
    }

    /**
     * Carrega os dados do sorteio.
     * @return ILoteria Auto retorno.
     */
    public function load(): ILoteria
    {
        $html = Web::loadHtml($this->getUrl());
        $this->results = json_decode($html, true);
        return $this;
    }
}