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
        $loteria = Loteria::factory(Execution::argument(1));
        if ($loteria != null) {
            if (Execution::isWeb()) $this->runAsWebPage($loteria);
            else $this->runAsScript($loteria);
        } else {
            echo 'Use uma das opções como argumento:' . Execution::newline();
            foreach (Loteria::available() as $name) echo " - $name" . Execution::newline();
        }
    }

    /**
     * Execução como: script por linha de comando.
     * @param ILoteria $loteria Instância a ser processada.
     */
    private function runAsScript(ILoteria $loteria): void {
        $loteria->load()->write();
    }

    /**
     * Execução como: página web
     * @param ILoteria $loteria Instância a ser processada.
     */
    private function runAsWebPage(ILoteria $loteria): void {

    }
}