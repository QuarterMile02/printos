// Locked, approved email signature template (fixed-width, table-based, Outlook-safe).
// Company info is shared/hardcoded here. Per-user fields (name, title, phone, mobile)
// are passed in from the caller, pulled live from profiles at send time.

const LOGO_URL = 'https://kituhlwixnuxjokflbsu.supabase.co/storage/v1/object/public/org-logos/signature-assets/qmi-stacked-logo.png'

const COMPANY = {
  address: '6420 Polaris Dr. Ste 4, Laredo, Texas 78041',
  website: 'https://www.QuarterMileInc.com',
  websiteLabel: 'www.QuarterMileInc.com',
}

const SERVICES = ['Branding', 'Marketing', 'Printing', 'Signs', 'Fleet']

export type SignatureFields = {
  fullName: string
  title?: string | null
  phone?: string | null
  mobile?: string | null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildSignatureHtml(fields: SignatureFields): string {
  const fullName = escapeHtml(fields.fullName || '')
  const title = fields.title?.trim() ? escapeHtml(fields.title.trim()) : ''
  const phone = fields.phone?.trim() ?? ''
  const mobile = fields.mobile?.trim() ?? ''

  const phoneLine = [
    phone ? `P: ${phone}` : '',
    mobile ? `M: ${mobile}` : '',
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ')

  const footerRow = SERVICES.map((s, i) => {
    const cell = `<td style="font-family:'Montserrat',sans-serif;font-size:9px;font-weight:700;color:#666;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;">${s}</td>`
    const dot = `<td style="padding:0 8px;font-family:'Montserrat',sans-serif;font-size:11px;color:#ee2b7b;line-height:1;">&bull;</td>`
    return cell + (i < SERVICES.length - 1 ? dot : '')
  }).join('\n            ')

  return `<style>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&display=swap');
</style>
<table cellpadding="0" cellspacing="0" border="0" width="400" style="width:400px;border-collapse:collapse;">
<tr><td style="padding:8px 0;">
<table cellpadding="0" cellspacing="0" border="0" width="400" style="width:400px;background:#fff;border:.5px solid #ddd;border-radius:8px;border-collapse:collapse;">
<tr><td style="border-radius:8px;overflow:hidden;">

  <table cellpadding="0" cellspacing="0" border="0" width="400" style="width:400px;border-collapse:collapse;">
    <tr><td style="background:#000;padding:9px 16px;text-align:center;">
      <p style="font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;color:#93ca3b;letter-spacing:.1em;text-transform:uppercase;margin:0;">Brand Visibility Solutions</p>
    </td></tr>
  </table>

  <table cellpadding="0" cellspacing="0" border="0" width="400" style="width:400px;border-collapse:collapse;">
    <tr>
      <td style="padding:14px 0 14px 16px;vertical-align:middle;width:88px;">
        <img src="${LOGO_URL}" width="88" height="88" style="display:block;width:88px;height:88px;object-fit:contain;border:0;" alt="QMI Stacked Logo">
      </td>
      <td style="padding:14px 16px 14px 18px;vertical-align:middle;">
        <p style="font-family:'Montserrat',sans-serif;font-size:15px;font-weight:700;color:#000;margin:0 0 1px;">${fullName}</p>
        ${title ? `<p style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:600;color:#93ca3b;text-transform:uppercase;letter-spacing:.08em;margin:0 0 7px;">${title}</p>` : ''}
        <div style="width:30px;height:2px;background:#ee2b7b;margin:0 0 8px;border-radius:1px;"></div>
        ${phoneLine ? `<p style="font-family:'Montserrat',sans-serif;font-size:11px;color:#555;margin:2px 0;">${phoneLine}</p>` : ''}
        <p style="font-family:'Montserrat',sans-serif;font-size:11px;color:#555;margin:2px 0;">${COMPANY.address}</p>
        <p style="font-family:'Montserrat',sans-serif;font-size:11px;color:#555;margin:2px 0;"><a href="${COMPANY.website}" style="color:#93ca3b;text-decoration:none;font-weight:600;">${COMPANY.websiteLabel}</a></p>
      </td>
    </tr>
  </table>

  <table cellpadding="0" cellspacing="0" border="0" width="400" style="width:400px;border-collapse:collapse;background:#f5f5f5;border-top:2px solid #93ca3b;">
    <tr>
      <td style="padding:7px 16px 7px 24px;">
        <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            ${footerRow}
          </tr>
        </table>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</td></tr>
</table>`
}
