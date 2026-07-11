# Instruções do repositório

## Commits Git

- Use a configuração efetiva do Git como fonte da identidade e das opções de assinatura dos commits.
- Execute `git commit` sem sobrescrever `user.name`, `user.email`, `user.signingkey` ou `commit.gpgsign` na linha de comando, por variáveis de ambiente ou na configuração local do repositório.
- Não use `--author` ou `--no-gpg-sign`. A configuração global do Git mantém a identidade e a assinatura consistentes entre projetos.
