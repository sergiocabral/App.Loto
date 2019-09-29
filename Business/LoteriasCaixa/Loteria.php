<?php


namespace Loto\Business\LoteriasCaixa;

use mysql_xdevapi\Exception;

/**
 * Funções utilitárias para este namespace.
 * @package Loto\Business\LoteriasCaixa
 */
class Loteria
{

    /**
     * Cria uma instância do manipulador de uma loteria.
     * @param string $name Nome da loteria.
     * @return ILoteria Manipulador da loteria indicada.
     * @throws \Exception
     */
    public static function factory(string $name): ILoteria {
        switch (strtolower(trim($name))) {
            case "megasena": return new LoteriaMegaSena();
            case "quina": return new LoteriaQuina();
        }
        throw new \Exception("Not found: $name");
    }
}