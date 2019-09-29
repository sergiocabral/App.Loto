<?php


namespace Loto\Business\LoteriasCaixa;

use Loto\Util\Execution;
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
     * @var string Valor da chave no JSON: Sorteio anterior
     */
    protected $jsonKeyPrevious = "jsonKeyPrevious";

    /**
     * @var string Valor da chave no JSON: Próximo sorteio
     */
    protected $jsonKeyNext = "jsonKeyNext";

    /**
     * @var string Valor da chave no JSON: Resultado
     */
    protected $jsonKeyResult = "jsonKeyResult";

    /**
     * @var string Valor da chave no JSON: Data
     */
    protected $jsonKeyDate = "jsonKeyDate";

    /**
     * @var int Identificador do sorteio atual.
     */
    protected $id = 1;

    /**
     * @var array Dados do sorteio atual.
     */
    protected $results = [];

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
        $result = explode('-', $this->results[strtolower($this->jsonKeyResult)]);
        $result = array_map("trim", $result);
        return $result;
    }

    /**
     * Retorna a data do sorteio.
     * @return string Resultados.
     */
    public function getDate(): string
    {
        return $this->results[strtolower($this->jsonKeyDate)];
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
        if (isset($this->results[strtolower($this->jsonKeyNext)])) {
            $this->id = (int)$this->results[strtolower($this->jsonKeyNext)];
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
        if (isset($this->results[strtolower($this->jsonKeyPrevious)])) {
            $this->id = (int)$this->results[strtolower($this->jsonKeyPrevious)];
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
        $this->results = array_change_key_case($this->results);
        return $this;
    }

    /**
     * Escreve os dados do sorteio atual
     * @return ILoteria Auto retorno.
     */
    public function write(): ILoteria {
        echo $this->getDate() . ' | ';
        echo implode('-', $this->getResults());
        echo Execution::newline();
        return $this;
    }
}