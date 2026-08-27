import Link from 'next/link'
import EnvsView from '../EnvsView'

export default function Page() {
  return (
    <main>
      <h1 style={{ fontSize: 18, fontWeight: 500, padding: '24px 24px 0' }}>envs</h1>
      <p style={{ fontSize: 13, padding: '0 24px' }}>
        <Link href="/">back to runs</Link>
      </p>
      <EnvsView />
    </main>
  )
}
