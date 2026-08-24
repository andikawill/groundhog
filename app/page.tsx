import RunView from './RunView'

export default function Page() {
  return (
    <main>
      <h1 style={{ fontSize: 18, fontWeight: 500, padding: '24px 24px 0' }}>groundhog</h1>
      <p style={{ fontSize: 13, opacity: 0.7, padding: '0 24px' }}>
        Replay needs the env file as it is now, not as it was — a run is only reproducible
        while that file is unchanged.
      </p>
      <RunView />
    </main>
  )
}
