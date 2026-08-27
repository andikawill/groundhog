import Link from 'next/link'
import EnvsView from '../EnvsView'

export default function Page() {
  return (
    <div className="app">
      <header className="app__header">
        <span className="brand">groundhog</span>
        <span className="spacer" />
        <nav className="nav">
          <Link href="/">runs</Link>
          <Link href="/envs" aria-current="page">
            envs
          </Link>
        </nav>
      </header>
      <div className="app__body app__body--wide">
        <h1 className="title">envs</h1>
        <EnvsView />
      </div>
    </div>
  )
}
