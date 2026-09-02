# Reconciliação do histórico de caixa (vendas fiadas antigas)

## Contexto

Até a correção da integração venda fiada → contas a receber → caixa, o caixa era
calculado somando **todas** as vendas por forma de pagamento, incluindo vendas
fiadas (que apareciam como entrada `fiado_cents` no dia da venda).

Após a correção:

- vendas fiadas **não** entram no caixa no momento da venda;
- o recebimento de fiado entra no caixa com a forma de pagamento do recebimento
  (tabela `cash_entries`).

Isso significa que sessões de caixa **fechadas antes da correção** podem conter
vendas fiadas contabilizadas como entrada. **Nada foi alterado nesses registros.**
Este documento descreve, para decisão futura do operador, como identificar e
reconciliar manualmente.

## Regras para reconciliação (não executada automaticamente)

1. Não apagar nem editar sessões, vendas, contas a receber ou recebimentos.
2. Não criar lançamentos artificiais (entradas/saídas) sem estratégia aprovada.
3. O objetivo da rotina seria apenas **recalcular a exibição** do histórico,
   preservando os valores físicos conferidos no fechamento da época.

## Candidatos à reconciliação

Consulta (para auditoria manual):

```sql
-- Sessões fechadas que registraram vendas fiadas como entrada
SELECT cs.id,
       cs.opened_at,
       cs.closed_at,
       cs.fiado_cents      AS fiado_gravado_na_epoca,
       cs.total_sales_cents AS total_gravado_na_epoca,
       COALESCE((
         SELECT SUM(s.total_cents)
         FROM sales s
         WHERE s.created_at >= cs.opened_at
           AND s.created_at <= cs.closed_at
           AND s.payment_method = 'fiado'
           AND s.status = 'ativa'
       ), 0)               AS fiado_hoje_no_periodo
FROM cash_sessions cs
WHERE cs.status = 'fechado'
  AND cs.fiado_cents > 0;
```

- `fiado_gravado_na_epoca > 0` → sessão contém fiado no caixa (regra antiga).
- `fiado_hoje_no_periodo` mostra o valor que, pela regra atual, seria apenas
  referência (coluna `fiado_cents`) e não faria parte do total.
- Recebimentos legítimos registrados após a correção ficam em `cash_entries`
  e entram normalmente nas sessões seguintes (por intervalo de tempo).

## Impacto da não-correção

- Relatórios de caixa históricos mostram números da época (fiado como entrada).
- O caixa atual, a partir da correção, segue a regra nova sem impacto.
- O total de "vendas" (dashboard/reports) e as faturas do dia não são afetados
  por sessões antigas fechadas.

## Decisões pendentes (a combinar com o operador)

1. Se o valor físico conferido no fechamento antigo incluía o fiado (ex.: o
   dinheiro já estava na gaveta), o histórico está **correto para a época** e
   nada precisa mudar — apenas a exibição de "Total recebido" muda para a regra
   nova nas sessões abertas daqui para frente.
2. Se houve divergência real entre o fechado e o físico, a correção seria um
   ajuste manual de sessão (não automático), com anotação em auditoria.
3. Onde houver recebimento de fiado feito **com caixa fechado**, o lançamento
   fica registrado em `cash_entries`, mas não pertence a nenhuma sessão fechada
   (o caixa é derivado por intervalo). Se necessário, esses valores entram na
   próxima sessão cujo intervalo contenha a data do recebimento, ou podem ser
   conferidos manualmente pelo relatório de recebimentos.
