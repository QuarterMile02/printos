# 2026-08-19 — QuickBooks Desktop IIF payments export: investigated, not built

## Status

**Investigation only. No exporter code written this pass.** Explicitly requested before
building: "investigate and report — do not assume" on the IIF record-type questions below,
plus a flag on whether it's safe to build a second IIF exporter right now. It isn't, yet —
see Recommendation.

## The blocking concern (flag requested explicitly)

`src/lib/iif/build-invoices-iif.ts`'s own header comment records a real regression: commit
`ddfdc7b` flipped `INVITEMTYPE` from the correct `SERV` to `SERVICE`, which QuickBooks
Desktop rejects outright ("SERVICE is an invalid value for field INVITEMTYPE [15106]"), and
that bug was live until 2026-08-16 — undetected for a real stretch of time. That means the
**existing, shipped INVOICE exporter has never been confirmed working end to end in real
QuickBooks Desktop**; its correctness has been established by re-reading the IIF spec, not
by a person actually importing a generated file into QB and watching it post cleanly.

Building a payments exporter now would mean shipping a second unvalidated IIF exporter next
to a first one that's *known* to have shipped at least one QB-rejecting bug already. If the
payments exporter has an equivalent mistake, the two failures compound into a debugging
problem that looks like "our IIF export doesn't work" with no way to isolate which exporter
or which specific field is wrong — worse than either one shipping broken alone.

**Recommendation: get someone to actually import a real `build-invoices-iif.ts` output file
into a QuickBooks Desktop company file (a test/sandbox file, not production) before starting
the payments exporter.** That single confirmation — or the specific error QB throws instead
— is worth more than any amount of additional spec-reading, for both exporters. This
matches the one recommendation nearly every IIF resource found below repeats: *manually
enter one example of the transaction type in QuickBooks first, then compare against what you
're about to generate* — the IIF spec is thin and inconsistently documented across QB
versions; a real round-trip is the only reliable check.

## a) What record type does a customer payment use?

**`TRNSTYPE` = `PAYMENT`.** Not `INVOICE` (obviously), and not `RECEIVEPMT` — that was my
first guess from the qbXML/SDK world (where the API call really is `ReceivePaymentAdd`), and
it's wrong for plain-text IIF. Confirmed independently across an Intuit Community thread on
importing customer payments, a real sample customer-payment IIF file (swagsys.com's IIF
import-source documentation), and a second Intuit Community thread — all agree on `PAYMENT`.

Structure, from a real sample file:

```
!TRNS  TRNSTYPE  DATE       ACCNT               NAME             AMOUNT  DOCNUM  MEMO         CLEAR  TOPRINT  PAID  PAYMETH      CLASS
!SPL   TRNSTYPE  DATE       ACCNT               NAME             AMOUNT  DOCNUM  MEMO         CLEAR  CLASS
!ENDTRNS
TRNS   PAYMENT   2/01/2015  Undeposited Funds   CASH SALES-CASH  0.00    29016   Debit Card   N      N        Y     Debit Card   1
SPL    PAYMENT   2/01/2015  Accounts Receivable CASH SALES-CASH  0.00    29016   Debit Card   N      1
ENDTRNS
```

Two lines, not itemized — no `INVITEM` block at all, unlike invoices. `TRNS` hits
**Undeposited Funds** (or a bank account, if payments don't get grouped into a deposit
first); the `SPL` line hits **Accounts Receivable**, both under the same customer `NAME`.
`PAYMETH` is a field that exists on payment `TRNS` lines and doesn't exist on invoice `TRNS`
lines — one concrete reason this can't be pattern-matched from the invoice exporter's field
list.

The sample above has both amounts at `0.00`, so it doesn't confirm sign convention directly.
By the same double-entry rule `build-invoices-iif.ts` already follows for invoices (`TRNS`
positive / `SPL` negative, summing to zero) — debit Undeposited Funds positive, credit
Accounts Receivable negative — is the standard accounting convention and consistent with
every other transaction type in that file. **This is inference from the existing exporter's
own established pattern, not something I found stated outright for `PAYMENT` specifically —
flagging as inferred, not confirmed**, exactly the kind of detail a real QB import round-trip
would settle for good.

One more concrete risk surfaced while researching this: a separate Intuit Community thread
reports `TRNSTYPE PAYMENT` IIF imports failing with `"Can't record invalid transaction"` in
some cases — no root cause identified in that thread. `PAYMENT` is a real, supported
`TRNSTYPE`, but it is evidently not a trouble-free one in practice.

## b) A payment applied across multiple invoices

**This is the load-bearing finding: IIF import does not link a payment to an invoice at
all — to one invoice or several.** Confirmed by three independent sources (an IIF-import
specialist site's own documentation, and two separate Intuit Community threads, one of them
specifically about importing customer payments):

> "Customer Payments (i.e. RECEIVE PAYMENTS) are NOT posted to any INVOICES but are left as
> just unapplied (dangling) credits for that customer."

> "The ability to link imported payments with your invoices is not available [via IIF] ...
> you'd have to manually mark your customer's invoice as paid" / "manually apply payments to
> specific invoices in QuickBooks" after import, via the Receive Payments window.

`DOCNUM` in the sample above is a payment/receipt reference number, not an invoice number,
and even where people try setting it to an invoice number, IIF import doesn't read it as an
application instruction — that linking mechanism (`AppliedToTxnAdd` / `LinkToTxn`) exists
only in the qbXML/QBFC SDK, which is a completely different integration path from plain-text
IIF import, and out of scope here.

So: our `payment_applications` table can express a $500 payment split $300/INV-1001,
$200/INV-1002 with full referential integrity — but there is no IIF construct that transmits
that split as an instruction QuickBooks will act on. The best an IIF export can do is put the
human-readable intent in `MEMO` (e.g. "Applied to INV-1001 $300, INV-1002 $200 — apply
manually in QuickBooks") and rely on someone in accounting doing the actual application
inside QuickBooks by hand, exactly as they already must for a single-invoice payment.

## c) An unapplied payment / 60-40 deposit with no invoice

Because *every* IIF-imported `PAYMENT` lands unapplied regardless of intent (per (b) above),
a genuinely-unapplied deposit and a payment meant for one specific invoice **export as the
identical IIF shape** — same `TRNS`/`SPL` pair, same accounts, no structural difference.
There's no separate "customer deposit" or "unapplied credit" `TRNSTYPE` to reach for; a
`PAYMENT` transaction with no matching invoice application performed afterward inside
QuickBooks simply **is** what QuickBooks calls an unapplied/dangling customer credit — that's
its natural, default resting state after IIF import, not a special case to build for.
`MEMO` is again the only lever: something like "Deposit — SO #1234, no invoice yet" versus
"Payment — apply to INV-1234" is the one signal available to whoever applies it by hand.

## d) Reuse of `build-invoices-iif.ts`

Genuinely reusable: the file-level scaffolding — `!TRNS`/`!SPL`/`!ENDTRNS` header rows, the
`iif()` tab/newline-escaping helper, `formatDate`, the customer-name resolution, batching
multiple transactions into one file, and the `account_mapping`/`qb_settings` lookup for
resolving account names per org.

Not reusable, because the record shape is fundamentally different: no `!INVITEM` block at
all (payments aren't itemized against product/service items — `build-invoices-iif.ts`'s
entire `SERV`/`INVITEMTYPE` section, including the exact thing that regressed once, has no
equivalent on the payment side), a required `PAYMETH` field that invoices don't carry, and —
the important one — no per-invoice application data to emit at all per (b)/(c) above, since
IIF has nowhere to put it. A payments exporter forced through the invoice exporter's
line-item loop would be modeling a linkage IIF cannot actually express.

## Sources

- [Importing customer payments — QuickBooks Community](https://quickbooks.intuit.com/learn-support/en-us/payments/importing-customer-payments/00/673680)
- [Sample Receipts/Customer Payment IIF File — swagsys.com](https://swagsys.com/ssi_help/sample_receipts_iif_file.htm)
- [QuickBooks IIF Files — AAATEX](https://aaatex.com/articles/quickbooks_iif_transactions_13.htm)
- [Importing Payments via IIF with Processing Fee — QuickBooks Community](https://quickbooks.intuit.com/learn-support/en-us/payments/importing-payments-via-iif-with-processing-fee/00/916429)
- [QuickBooks IIF File Tips & Best Practices — imrchnt](https://imrchnt.screenstepslive.com/s/17626/a/1199999-quickbooks-iif-file-tips-best-practices)
- `src/lib/iif/build-invoices-iif.ts`'s own header comment (the `SERV`/`SERVICE` regression, live until 2026-08-16)
