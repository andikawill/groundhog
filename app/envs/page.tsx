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
      {/* One child, because the body row is the full height of the window and the screen's
          title belongs on the same row as the matrix's write target — both of which are
          EnvsView's to render, since only it knows the root. */}
      <div className="app__body app__body--wide">
        <EnvsView />
      </div>
    </div>
  )
}
