# Instruções do repositório

## Commits Git

- Use a configuração efetiva do Git como fonte da identidade e das opções de assinatura dos commits.
- Execute `git commit` sem sobrescrever `user.name`, `user.email`, `user.signingkey` ou `commit.gpgsign` na linha de comando, por variáveis de ambiente ou na configuração local do repositório.
- Não use `--author` ou `--no-gpg-sign`. A configuração global do Git mantém a identidade e a assinatura consistentes entre projetos.

## Testes antes de envio remoto

- Alterações de comportamento devem incluir testes proporcionais ao risco da mudança.
- Commits locais podem ser criados antes da conclusão dos testes.
- Antes de qualquer `git push`, execute `npm test` após a última alteração versionada.
- Não execute `git push` com testes falhando, sem cobrir o comportamento alterado ou quando `npm test` não puder ser concluído; registre o impedimento e não faça o envio.
