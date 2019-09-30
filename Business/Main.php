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
        $this->dump(Loteria::factory("DiaDeSorte"));
        $this->dump(Loteria::factory("DuplaSena"));
        $this->dump(Loteria::factory("LotoFacil"));
        $this->dump(Loteria::factory("LotoMania"));
        $this->dump(Loteria::factory("MegaSena"));
        $this->dump(Loteria::factory("Quina"));
        $this->dump(Loteria::factory("TimeMania"));
    }

    private function dump(ILoteria $loteria): void {
        $loteria->load()->write();
    }
}