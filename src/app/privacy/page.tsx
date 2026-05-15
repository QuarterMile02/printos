import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | Quarter Mile Inc.',
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-gray-800">
      <h1 className="text-3xl font-extrabold mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Quarter Mile Inc. &mdash; Last updated May 14, 2025</p>

      <section className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
          <p>
            Quarter Mile Inc. (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is committed to protecting your
            personal information. This Privacy Policy explains how we collect, use, and share
            information when you interact with us, including through SMS messaging.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
          <p>We may collect the following types of information:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Contact information: name, phone number, email address, and mailing address.</li>
            <li>Order and transaction details related to print services.</li>
            <li>SMS consent status and messaging history.</li>
            <li>Website usage data collected via cookies and analytics tools.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. SMS Messaging</h2>
          <p>
            If you provide your mobile phone number and opt in to receive SMS messages from Quarter Mile
            Inc., we will send you automated text messages about your quotes, design proofs, and order
            updates. Message frequency varies per order (typically 2–5 messages per order).
          </p>
          <p className="mt-2">
            <strong>Message and data rates may apply.</strong> You can opt out at any time by replying
            <strong> STOP</strong> to any message we send. Reply <strong>HELP</strong> for assistance.
            Opting in to SMS is not required to make a purchase.
          </p>
          <p className="mt-2">
            We do not sell, rent, or share your phone number or SMS consent with third parties for
            their marketing purposes.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. How We Use Your Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To fulfill and communicate about your print orders.</li>
            <li>To send you transactional SMS messages if you have opted in.</li>
            <li>To improve our services and customer experience.</li>
            <li>To comply with legal obligations.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Information Sharing</h2>
          <p>
            We do not sell your personal information. We may share information with trusted service
            providers who assist us in operating our business (e.g., SMS delivery platforms), subject
            to confidentiality agreements. We may also disclose information as required by law.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. Data Retention</h2>
          <p>
            We retain your personal information for as long as necessary to provide services, fulfill
            legal obligations, and resolve disputes. SMS consent records are retained for a minimum of
            four years as required by applicable regulations.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">7. Your Rights</h2>
          <p>
            Depending on your location, you may have the right to access, correct, or delete your
            personal information. To exercise these rights or to opt out of SMS communications, contact
            us at:
          </p>
          <address className="not-italic mt-2">
            <strong>Quarter Mile Inc.</strong><br />
            Email: <a href="mailto:hello@quartermileinc.com" className="underline text-blue-600">hello@quartermileinc.com</a><br />
            Phone: <a href="tel:+1" className="underline text-blue-600">Contact us via our website</a>
          </address>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">8. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The most current version will always
            be available at <strong>printos-lemon.vercel.app/privacy</strong>. Continued use of our
            services after changes constitutes your acceptance of the updated policy.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">9. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, please contact us at{' '}
            <a href="mailto:hello@quartermileinc.com" className="underline text-blue-600">hello@quartermileinc.com</a>.
          </p>
        </div>
      </section>

      <div className="mt-12 border-t border-gray-200 pt-6 text-xs text-gray-400">
        <a href="/terms" className="underline mr-4">Terms of Service</a>
        <a href="/" className="underline">Home</a>
      </div>
    </main>
  )
}
