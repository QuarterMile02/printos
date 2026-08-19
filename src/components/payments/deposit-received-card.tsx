'use client'

import { useState } from 'react'
import RecordPaymentForm, { type PaymentMethodOption } from './record-payment-form'
import type { PaymentTargetType } from '@/app/actions/record-payment'
import type { PublicGatewayConfig } from '@/lib/payments/gateway-config'

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = {
  orgId: string
  orgSlug: string
  customerId: string
  target: { type: PaymentTargetType; id: string }
  depositReceivedCents: number
  depositRequiredCents: number // 0 if no down-payment term configured
  paymentMethods: PaymentMethodOption[]
  gatewayConfig?: PublicGatewayConfig
}

// Live query against payment_applications at display time, per the
// deliberate decision NOT to denormalize amount_paid/balance_due onto
// quotes/sales_orders -- this card is that follow-up UI work.
export default function DepositReceivedCard({
  orgId, orgSlug, customerId, target, depositReceivedCents, depositRequiredCents, paymentMethods, gatewayConfig,
}: Props) {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Deposit</h2>
      <div className="space-y-3 text-sm">
        {depositRequiredCents > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500">Required</span>
            <span className="font-medium text-gray-900">${formatCents(depositRequiredCents)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Received</span>
          <span className="font-medium text-green-700">${formatCents(depositReceivedCents)}</span>
        </div>
        {depositRequiredCents > 0 && (
          <div className="flex justify-between border-t border-gray-100 pt-3">
            <span className="font-semibold text-gray-900">Remaining</span>
            <span className={`font-extrabold ${depositRequiredCents - depositReceivedCents > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              ${formatCents(Math.max(0, depositRequiredCents - depositReceivedCents))}
            </span>
          </div>
        )}
      </div>
      <button
        onClick={() => setShowModal(true)}
        className="mt-4 rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
      >
        Record Payment
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Record Payment</h2>
            <RecordPaymentForm
              orgId={orgId}
              orgSlug={orgSlug}
              customerId={customerId}
              target={target}
              defaultAmountCents={Math.max(0, depositRequiredCents - depositReceivedCents) || depositReceivedCents}
              paymentMethods={paymentMethods}
              gatewayConfig={gatewayConfig}
              revalidatePath={target.type === 'quote' ? `/dashboard/${orgSlug}/quotes/${target.id}` : `/dashboard/${orgSlug}/sales-orders/${target.id}`}
              onRecorded={() => setShowModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
