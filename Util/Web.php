<?php

namespace Loto\Util;

/**
 * Utilitários para contexto web.
 * @package Loto\Util
 */
class Web
{

    /**
     * Carrega uma página da internet.
     * @param string $url Url.
     * @param string $cookieDir Opcional. Diretório de gravação dos cookies.
     * @param string $cookiePrefix Opcional. Prefixo do arquivo de cookie.
     * @param string $cookieSuffix Opcional. Sufixo (extensão) do arquivo de cookie.
     * @return string Conteúdo da página.
     */
    public static function loadHtml(string $url, string $cookieDir = ".", $cookiePrefix = "cookie.", $cookieSuffix = ".txt"): string {
        $useragent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.89 Safari/537.36';
        $timeout = 120;

        $cookie_file =
            !empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] :
                (!empty($_SERVER['COMPUTERNAME']) ? $_SERVER['COMPUTERNAME'] : "");
        $cookie_file = realpath($cookieDir) . '/' . $cookiePrefix . md5($cookie_file) . $cookieSuffix;

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_FAILONERROR, true);
        curl_setopt($ch, CURLOPT_HEADER, 0);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $cookie_file);
        curl_setopt($ch, CURLOPT_COOKIEJAR, $cookie_file);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true );
        curl_setopt($ch, CURLOPT_ENCODING, "" );
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true );
        curl_setopt($ch, CURLOPT_AUTOREFERER, true );
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout );
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout );
        curl_setopt($ch, CURLOPT_MAXREDIRS, 10 );
        curl_setopt($ch, CURLOPT_USERAGENT, $useragent);
        curl_setopt($ch, CURLOPT_REFERER, 'https://www.google.com/');
        $content = curl_exec($ch);

        if (empty($content) && curl_errno($ch)) {
            $content = curl_error($ch);
        }

        curl_close($ch);

        return $content;
    }

}