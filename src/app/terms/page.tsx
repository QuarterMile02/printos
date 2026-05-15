import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | Quarter Mile Inc.',
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-extrabold mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Quarter Mile Inc. &mdash; Last updated May 14, 2025</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
          <p>
            By using the services of Quarter Mile Inc. (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;), including our SMS messaging program, you agree to these Terms of
            Service. If you do not agree, do not use our services.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. SMS Messaging Program</h2>
          <p>
            By providing your mobile phone number and checking the SMS consent box, you agree to
            receive automated text messages from Quarter Mile Inc. regarding:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Quote status updates and approvals</li>
            <li>Design proof notifications and approval requests</li>
            <li>Order production and delivery updates</li>
            <li>Pickup or delivery readiness notifications</li>
          </ul>
          <p className="mt-2">
            <strong>Message frequency:</strong> Typically 2–5 messages per order, depending on the
            order workflow. Frequency may vary.
          </p>
          <p className="mt-2">
            <strong>Message and data rates may apply.</strong> Standard carrier rates apply to all
            SMS messages sent and received.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. How to Opt Out</h2>
          <p>
            You may opt out of SMS messages at any time by replying <strong>STOP</strong> to any
            message from us. After opting out, you will receive a single confirmation message and no
            further SMS messages will be sent unless you re-enroll.
          </p>
          <p className="mt-2">
            To opt back in, contact us at{' '}
            <a href="mailto:hello@quartermileinc.com" className="underline text-blue-600">hello@quartermileinc.com</a>{' '}
            or speak to your sales representative.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. How to Get Help</h2>
          <p>
            Reply <strong>HELP</strong> to any of our SMS messages to receive contact information and
            instructions. You may also contact us directly at:
          </p>
          <address className="not-italic mt-2">
            <strong>Quarter Mile Inc.</strong><br />
            Email: <a href="mailto:hello@quartermileinc.com" className="underline text-blue-600">hello@quartermileinc.com</a>
          </address>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Consent Is Not Required for Purchase</h2>
          <p>
            Consent to receive SMS messages is not a condition of any purchase from Quarter Mile Inc.
            You may opt out at any time without affecting your ability to place or receive orders.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. Supported Carriers</h2>
          <p>
            Our SMS program is supported by most major US carriers including AT&amp;T, Verizon,
            T-Mobile, Sprint, and others. Carrier support may vary.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">7. Service Terms</h2>
          <p>
            We reserve the right to modify or discontinue the SMS program at any time. We are not
            liable for delays or failures in SMS delivery due to carrier or network conditions beyond
            our control.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">8. Privacy</h2>
          <p>
            Your personal information is handled in accordance with our{' '}
            <a href="/privacy" className="underline text-blue-600">Privacy Policy</a>. We do not sell
            or share your phone number with third parties for marketing purposes.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">9. Changes to These Terms</h2>
          <p>
            We may update these Terms of Service at any time. The current version is always available
            at <strong>printos-lemon.vercel.app/terms</strong>. Continued use of our SMS program after
            changes constitutes acceptance.
          </p>
        </div>
      </section>

      <div className="mt-12 border-t border-gray-200 pt-6 text-xs text-gray-400">
        <a href="/privacy" className="underline mr-4">Privacy Policy</a>
        <a href="/" className="underline">Home</a>
      </div>
    </main>
  )
}
