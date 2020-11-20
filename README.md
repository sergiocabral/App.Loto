# Loto

Este script coleta dados (web scraper) do site Loterias da Caixa, em http://loterias.caixa.gov.br.

A execução pode ser via **linha de comando** ou **página de internet** (https://sergiocabral.com/sorteios/
).

Em ambos os casos deve receber como parâmetro o nome da loteria. Se não for informado será exibida uma lista com as opções disponíveis.

## Por linha de comando

- Para exibir as loterias disponíveis
  - `php loto.php`
- Para começar a coletar os resultados para um arquivo.
  - `php loto.php [nome-da-loteria]`
- Para fazer uma consulta simples (sem gravação em arquivo) de um sorteio específico.
  - `php loto.php [nome-da-loteria] [número-do-sorteio]` 

### Printscreen

- ![Comando inicial](https://i.imgur.com/VUSakoE.png)
- ![Exibição de resultados](https://i.imgur.com/ITI4m7H.png)


## Por página de internet

- Para exibir as loterias disponíveis
  - `http://<url-da-pagina>/`
- Para começar a coletar os resultados para um arquivo.
  - `http://<url-da-pagina>/[nome-da-loteria]`
- Para fazer uma consulta simples (sem gravação em arquivo) de um sorteio específico.
  - `http://<url-da-pagina>/[nome-da-loteria]/[número-do-sorteio]`

### Printscreen

- ![Tela inicial](https://i.imgur.com/OGESD8U.png)
- ![Exibição de resultados](https://i.imgur.com/GYoVmXB.png)
