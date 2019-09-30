<?php


namespace Loto\Business\LoteriasCaixa;

use Loto\Util\Execution;
use Loto\Util\Web;

/**
 * Classe base das classes de manipulação de dados de loteria.
 * Funções utilitárias para este namespace.
 * @package Loto\Business\LoteriasCaixa
 */
abstract class Loteria implements ILoteria
{

    /**
     * Cria uma instância do manipulador de uma loteria.
     * @param string $name Nome da loteria.
     * @return ILoteria Manipulador da loteria indicada.
     * @throws \Exception
     */
    public static function factory(string $name): ?ILoteria
    {
        if (!empty($name)) {
            foreach (scandir(dirname(__FILE__)) as $file) {
                if (strtolower($file) === strtolower("Loteria$name.php")) {
                    $className = __NAMESPACE__ . '\\' . substr($file, 0, -4);
                    return new $className;
                }
            }
        }
        return null;
    }

    /**
     * Lista de opções disponíveis para usar como argumento de factory().
     * @return array Opções disponíveis.
     */
    public static function available(): array {
        $options = [];
        foreach (scandir(dirname(__FILE__)) as $file) {
            preg_match('/(?<=Loteria).+(?=\.php)/i', $file, $match);
            if (count($match) === 1) $options[] = $match[0];
        }
        return $options;
    }
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
     * @var int Total de números possíveis nos sorteios.
     */
    protected $countNumbers = 0;

    /**
     * @var int Largura do identificador do sorteio.
     */
    protected $paddingId = 5;

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
        $result = isset($this->results[strtolower($this->jsonKeyResult)]) ? explode('-', $this->results[strtolower($this->jsonKeyResult)]) : [];
        $result = array_map("trim", $result);
        sort($result);
        return $result;
    }

    /**
     * Retorna a data do sorteio.
     * @return string Resultados.
     */
    public function getDate(): string
    {
        return isset($this->results[strtolower($this->jsonKeyDate)]) ? $this->results[strtolower($this->jsonKeyDate)] : '';
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
            $id = (int)$this->results[strtolower($this->jsonKeyNext)];
            if ($id == $this->id) $id++;
            $this->id = $id;
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
            $id = (int)$this->results[strtolower($this->jsonKeyPrevious)];
            if ($id == $this->id) $id--;
            $this->id = $id;
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
        try {
            $html = Web::loadHtml($this->getUrl());
            $this->results = json_decode($html, true);
            if (is_array($this->results)) $this->results = array_change_key_case($this->results);
            else $this->results = [];
        }
        catch (\Exception $exception) {
            $this->results = [];
        }
        return $this;
    }

    /**
     * Dados do sorteio como texto.
     * @return string Valor.
     */
    public function getText(): string {
        $text = "";

        $results = $this->getResults();

        if (count($results)) {
            $text .= str_pad($this->id, $this->paddingId, '0', STR_PAD_LEFT) . ' | ';
            $text .= $this->getDate() . ' | ';
            $text .= implode(' ', $results);

            $formatted = $this->format($results);
            if (!empty($formatted)) $text .= ' | ' . $formatted;

            $text .= Execution::newline();
        }

        return $text;
    }

    /**
     * Escreve os dados do sorteio atual
     * @return ILoteria Auto retorno.
     */
    public function write(): ILoteria {
        echo $this->getText();
        return $this;
    }

    /**
     * Formata a exibição dos resultados.
     * @param array $results Resultados.
     * @return string Resultados formatado.
     */
    protected function format(array $results): string {
        $length = strlen($this->countNumbers - 1);
        $formatted = '';
        for ($i = 0; $i < $this->countNumbers; $i++) {
            $formatted .= ' ' . (in_array($i, $results) ? str_pad($i, $length, '0', STR_PAD_LEFT) : str_repeat(' ', $length));
        }
        return substr($formatted, 1);
    }
}