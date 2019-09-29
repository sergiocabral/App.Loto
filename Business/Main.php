<?php

namespace Loto\Business;

use Loto\Business\LoteriasCaixa\ILoteria;
use Loto\Business\LoteriasCaixa\Loteria;
use Loto\Util\Execution;

/*
 * Classe principal do projeto.
 */
class Main
{

    /*
     * Construtor.
     * Ponto de entrada na execução do projeto.
     */
    public function __construct()
    {
        $this->dump(Loteria::factory("megasena"));
        $this->dump(Loteria::factory("quina"));
    }

    private function dump(ILoteria $loteria): void {
        echo "---\n";
        echo $loteria->setId(1)->load()->getResults()["resultado"] . "\n";
        echo $loteria->nextId()->load()->getResults()["resultado"] . "\n";
        echo $loteria->nextId()->load()->getResults()["resultado"] . "\n";
        echo "---\n";
    }
}