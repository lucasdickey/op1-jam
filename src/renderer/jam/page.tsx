import Jam from "./jam";

// The window's page: Claude plays an OP-1 over USB MIDI. The page keeps time
// and loops the current pattern; Claude writes the next one every few loops,
// and it takes over at the top of the loop.
export default function Op1() {
  return (
    <main className="op-main">
      <header className="op-head">
        <span className="op-tag">[ OP-1 JAM ]</span>
        <h1 className="op-title">Claude plays, you pick the sound</h1>
        <p className="op-note">
          Claude writes the notes. Your OP-1 plays them on whatever sound you pick.
        </p>
      </header>
      <Jam />
    </main>
  );
}
