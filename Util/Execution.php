<?php


namespace Loto\Util;

/**
 * Utilitários referente a execução do programa.
 * @package Loto\Util
 */
class Execution
{
    /**
     * Determina se a execução é por um navegador de internet.
     * @return bool Resposta.
     */
    public static function isWeb(): bool {
        return isset($_SERVER["REMOTE_ADDR"]);
    }

    /**
     * Retorna os argumentos passados para o programa.
     * @return array Lista de argumentos.
     */
    public static function arguments(): array {
        if (self::isWeb()) {
            $arguments = array_filter(explode('/', $_SERVER['QUERY_STRING']), function ($value) { return $value !== ""; });
            array_unshift($arguments, $_SERVER["SCRIPT_FILENAME"]);
        } else {
            global $argv;
            $arguments = $argv;
        }

        return $arguments;
    }

    /**
     * Retorna um argumento passado para o programa.
     * @param int $index Posição do argumento.
     * @return string Valor do argumento.
     */
    public static function argument(int $index): string {
        $arguments = self::arguments();
        return isset($arguments[$index]) ? $arguments[$index] : "";
    }
}