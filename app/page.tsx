import RunView from './RunView'

// The run screen's header carries the case picker, the env picker and the run button, all of
// which hold state, so the shell is rendered by the client component rather than here.
export default function Page() {
  return <RunView />
}
