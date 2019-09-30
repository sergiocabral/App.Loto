<?php


namespace Loto\Util;

/**
 * Utilitários para arquivos e diretórios.
 * @package Loto\Util
 */
class File
{

    /**
     * Adiciona um texto no começo do arquivo.
     * @param string $text Texto.
     * @param string $path Arquivo.
     * @return bool Indica sucesso com true.
     */
    public static function prepend(string $text, string $path): bool {
        if (!file_exists($path)) file_put_contents($path, '');
        if (!file_exists($path)) return false;

        $context = stream_context_create();
        $file = fopen($path, 'r', 0, $context);

        $pathTemp = tempnam(sys_get_temp_dir(), 'php_prepend_');
        file_put_contents($pathTemp, $text);
        file_put_contents($pathTemp, $file, FILE_APPEND);

        fclose($file);
        unlink($path);
        rename($pathTemp, $path);

        return true;
    }
}