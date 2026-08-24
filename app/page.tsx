import RunView from './RunView'

export default function Page() {
  return (
    <main>
      <h1 style={{ fontSize: 18, fontWeight: 500, padding: '24px 24px 0' }}>groundhog</h1>
      <p style={{ fontSize: 13, opacity: 0.7, padding: '0 24px' }}>
        Replay reads the case and env files as they are now, not as they were — a run is only
        reproducible while both are unchanged. A resume is different: it continues from the
        case the run started with.
      </p>
      <RunView />
    </main>
  )
}
