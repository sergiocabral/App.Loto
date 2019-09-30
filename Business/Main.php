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
            $this->run($loteria);
        } else {
            $this->help();
        }
    }

    /**
     * Texto de ajuda.
     */
    private function help(): void {
        if (Execution::isWeb()) {
            ?>
            <html>
            <head>
                <title>Loterias da Caixa</title>
            </head>
            <body>
                <h1>Loterias da Caixa</h1>
                <h2>Use uma das opções:</h2>
                <ul>
                    <?php foreach (Loteria::available() as $name): ?>
                        <li><h3><a href="?<?php echo $name;?>"><?php echo $name;?></a></h3></li>
                    <?php endforeach; ?>
                </ul>
            </body>
            </html>
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
        if (Execution::isWeb()) header("Content-Type: text/plain");
        $id = Execution::argument(2);
        if (!empty($id)) {
            if (is_numeric($id) && $id > 0) {
                echo 'Consultando sorteio ' . ((int)$id) . ' da ' . $loteria->getName() . '...' . PHP_EOL;
                echo PHP_EOL;
                $loteria->setId($id)->load()->write();
                if (!count($loteria->getResults())) {
                    echo "Sem resultados." . PHP_EOL;
                }
            } else {
                echo "O sorteio deve ser numérico e maior que zero." . PHP_EOL;
            }
        } else {
            echo $loteria->getName() . PHP_EOL;
            echo PHP_EOL;

            if (Execution::isWeb()) $this->runAsWebPage($loteria);
            else $this->runAsScript($loteria);
        }
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

    }
}