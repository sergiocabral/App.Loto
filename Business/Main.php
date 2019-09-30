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
        $loteria = Loteria::factory("DuplaSena");

        $loteria->setId(1990)->load()->write();
        $loteria->nextId()->load()->write();
        $loteria->nextId()->load()->write();
        $loteria->nextId()->load()->write();
        $loteria->nextId()->load()->write();
    }
}