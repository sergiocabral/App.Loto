<?php

/**
 * Implementação da PSR-4: Class Auto Loader.
 * @param string $class Nome completo da classe.
 * @return void
 */
spl_autoload_register(function ($class) {
    // Namespace base do projeto.
    $prefix = 'Loto\\';

    // Caminho base do código-fonte.
    $base_dir = __DIR__ . '/';

    // Verifica se a classe pertence a este projeto.
    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        // Caso não, passa o processamento ao próximo autoloader registrado.
        return;
    }

    // Retorna o nome relativo da classe.
    $relative_class = substr($class, $len);

    // Substitui o prefixo do namespace pelo caminho base.
    // Substitui os separadores do namespace por separadores de diretório.
    // Adiciona a extensão .php
    $file = $base_dir . str_replace('\\', '/', $relative_class) . '.php';

    // Se o arquivo existe faz o carregamento.
    if (file_exists($file)) {
        /** @noinspection PhpIncludeInspection */
        require $file;
    }
});

// Ponto de entrada do projeto.
new Loto\Business\Main();