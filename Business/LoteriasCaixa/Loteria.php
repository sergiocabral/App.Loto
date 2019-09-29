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
        $files = scandir(dirname(__FILE__));
        foreach ($files as $file) {
            if (strtolower($file) === strtolower("Loteria$name.php")) {
                $className = __NAMESPACE__ . '\\' . substr($file, 0, -4);
                return new $className;
            }
        }
        throw new \Exception("Not found: $name");
    }
}