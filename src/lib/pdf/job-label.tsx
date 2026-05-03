import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer'

export type JobLabelData = {
  jobNumber: string        // "JOB-0234"
  customerName: string
  dueDate: string | null   // formatted, e.g. "May 8, 2026"
  department: string | null
  printer: string | null
  qrDataUrl: string        // data:image/png;base64,...
}

const LIME  = '#93ca3b'
const BLACK = '#1a1a1a'
const GRAY  = '#6b7280'
const DARK  = '#374151'

const styles = StyleSheet.create({
  page: {
    width: 144,
    height: 144,
    backgroundColor: '#ffffff',
    fontFamily: 'Helvetica',
    flexDirection: 'column',
  },
  greenBar: {
    height: 14,
    backgroundColor: LIME,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barText: {
    fontSize: 7,
    color: '#ffffff',
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
  },
  body: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 4,
    flexDirection: 'column',
    alignItems: 'center',
  },
  jobNumber: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
    marginBottom: 2,
    alignSelf: 'flex-start',
  },
  customer: {
    fontSize: 7.5,
    color: DARK,
    alignSelf: 'flex-start',
    marginBottom: 1.5,
  },
  dueDate: {
    fontSize: 7.5,
    color: DARK,
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  qr: {
    width: 68,
    height: 68,
  },
  spacer: {
    flex: 1,
  },
  footer: {
    fontSize: 6.5,
    color: GRAY,
    textAlign: 'center',
  },
})

function trunc(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export default function JobLabelsDocument({ labels }: { labels: JobLabelData[] }) {
  return (
    <Document>
      {labels.map((data, i) => {
        const footerParts = [data.department, data.printer].filter(Boolean)
        const footer = footerParts.join('  ·  ')
        return (
          <Page key={i} size={{ width: 144, height: 144 }} style={styles.page}>
            <View style={styles.greenBar}>
              <Text style={styles.barText}>QMI</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.jobNumber}>{data.jobNumber}</Text>
              <Text style={styles.customer}>{trunc(data.customerName, 28)}</Text>
              {data.dueDate ? <Text style={styles.dueDate}>Due  {data.dueDate}</Text> : null}
              <Image src={data.qrDataUrl} style={styles.qr} />
              <View style={styles.spacer} />
              {footer ? <Text style={styles.footer}>{footer}</Text> : null}
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
