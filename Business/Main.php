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
        $title = "Loterias da Caixa";
        if (Execution::isWeb()) echo "<html><head><title>$title</title><link rel='stylesheet' type='text/css' href='/style.css'></head><body><h1><a href='/'>$title</a></h1>";
        else echo $title . PHP_EOL . PHP_EOL;

        $loteria = Loteria::factory(Execution::argument(1));
        if ($loteria != null) {
            $this->run($loteria);
        } else {
            $this->help();
        }

        if (Execution::isWeb()) echo "</body></html>";
    }

    /**
     * Texto de ajuda.
     */
    private function help(): void {
        if (Execution::isWeb()) {
            ?>
            <h2>Use uma das opções:</h2>
            <ul>
                <?php foreach (Loteria::available() as $name): ?>
                    <li><h3><a href="?<?php echo $name;?>"><?php echo $name;?></a></h3></li>
                <?php endforeach; ?>
            </ul>
            <?php
        } else {
            echo 'Use uma das opções como argumento:' . PHP_EOL;
            foreach (Loteria::available() as $name) echo " - $name" . PHP_EOL;
        }
    }

    /**
     * Execução do script.
     * @param ILoteria $loteria Instância a ser processada.
     */
    private function run(ILoteria $loteria): void {
        $id = Execution::argument(2);

        $title = 'Loteria: ' . $loteria->getName();
        if (Execution::isWeb()) echo "<h2>$title</h2><pre>";
        else echo $title . PHP_EOL . PHP_EOL;

        if (!empty($id)) {
            if (is_numeric($id) && $id > 0) {
                echo 'Consultando sorteio ' . ((int)$id) . '...' . PHP_EOL;
                echo PHP_EOL;
                $loteria->setId($id)->load()->write();
                if (!count($loteria->getResults())) {
                    echo "Sem resultados." . PHP_EOL;
                }
            } else {
                echo "O sorteio deve ser numérico e maior que zero." . PHP_EOL;
            }
        } else {
            if (Execution::isWeb()) $this->runAsWebPage($loteria);
            else $this->runAsScript($loteria);
        }

        if (Execution::isWeb()) echo "</pre>";
    }

    /**
     * Execução como: script por linha de comando.
     * @param ILoteria $loteria Instância a ser processada.
     */
    private function runAsScript(ILoteria $loteria): void {
        $loteria->setId($loteria->getIdFromFile())->load();
        if (count($loteria->getResults())) {
            while (count($loteria->getResults())) {
                $loteria->writeToFile()->write()->nextId()->load();
            }
            echo PHP_EOL;
        }

        echo "Todos os resultados foram carregados para o arquivo: " . PHP_EOL;
        echo realpath($loteria->getFile()) . PHP_EOL;
        echo PHP_EOL;
    }

    /**
     * Execução como: página web
     * @param ILoteria $loteria Instância a ser processada.
     */
    private function runAsWebPage(ILoteria $loteria): void {
        $batch = 30;
        $loteria->setId($loteria->getIdFromFile())->load();
        if (count($loteria->getResults())) {
            header("Refresh: 0");

            echo "Coletando resultados..." . PHP_EOL;
            echo PHP_EOL;

            while (count($loteria->getResults()) && $batch > 0) {
                $loteria->writeToFile()->nextId()->load();
                $batch--;
            }
        } else {
            echo "Todos os resultados exibidos." . PHP_EOL;
            echo PHP_EOL;
        }

        $file = $loteria->getFile();
        if (file_exists($file)) echo file_get_contents($file);
    }
}